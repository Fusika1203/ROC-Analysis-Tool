import React, { useState, useMemo, useCallback, useRef } from 'react';
import Papa from 'papaparse';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceDot,
  Legend,
  AreaChart,
  Area
} from 'recharts';
import { UploadCloud, AlertCircle, CheckCircle2, ChevronRight, Activity, Download, FileDown, Image as ImageIcon, Info, Github, Star, Database, TrendingUp, Calculator, Layout, FileText, ShieldCheck } from 'lucide-react';
import { calculateMetricsAtCutoff, calculateOptimalRoc, calculateMetricsForCutoff, RocPoint, RocMetrics } from './lib/roc';
import { toPng, toJpeg, toSvg } from 'html-to-image';
import { jsPDF } from 'jspdf';

const COLORS = ['#2563eb', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#14b8a6'];

type RocResult = {
  points: RocPoint[];
  auc: number;
  optimalCutoff: number;
  maxYoudenJ: number;
  direction: 'gt' | 'lt';
  optimalMetrics: RocMetrics;
  aucCi?: { lowerBound: number; upperBound: number };
  evalData: number[];
  labelData: number[];
};

export default function App() {
  const [data, setData] = useState<any[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [outcomeVar, setOutcomeVar] = useState<string>('');
  const [evalVars, setEvalVars] = useState<string[]>([]);
  const [positiveClass, setPositiveClass] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const [rocResults, setRocResults] = useState<Record<string, RocResult>>({});

  const [multiOverrides, setMultiOverrides] = useState<Record<string, { cutoff: number, direction: 'gt' | 'lt' }>>({});

  const [missingDataSummary, setMissingDataSummary] = useState<Record<string, { total: number, valid: number, missing: number }> | null>(null);

  const [userCutoff, setUserCutoff] = useState<number | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'analysis' | 'about'>('analysis');

  const handleDirectionChange = (key: string, newDirection: 'gt' | 'lt') => {
    const result = rocResults[key];
    if (!result) return;
    
    const newResult = calculateOptimalRoc(result.evalData, result.labelData, 1, true, newDirection);
    setRocResults(prev => ({
      ...prev,
      [key]: {
        ...newResult,
        evalData: result.evalData,
        labelData: result.labelData
      }
    }));
    
    // If this is the only variable, update the userCutoff
    if (evalVars.length === 1 && evalVars[0] === key) {
      setUserCutoff(newResult.optimalCutoff);
    }
  };

  const handleCutoffChange = (key: string, newCutoff: number) => {
    const result = rocResults[key];
    if (!result) return;

    setMultiOverrides(prev => ({
      ...prev,
      [key]: { 
        cutoff: newCutoff, 
        direction: prev[key]?.direction || result.direction 
      }
    }));

    if (evalVars.length === 1 && evalVars[0] === key) {
      setUserCutoff(newCutoff);
    }
  };

  const chartRef = useRef<HTMLDivElement>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      setFileName(null);
      return;
    }
    setFileName(file.name);

    Papa.parse(file, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: 'greedy',
      transformHeader: (header) => header.trim(),
      transform: (value) => (typeof value === 'string' ? value.trim() : value),
      complete: (results) => {
        if (results.errors.length > 0) {
          setError('Error parsing CSV file.');
          return;
        }
        const parsedData = results.data as any[];
        if (parsedData.length === 0) {
          setError('CSV file is empty.');
          return;
        }
        setData(parsedData);
        setColumns(Object.keys(parsedData[0]));
        setError(null);
        setWarning(null);
        setOutcomeVar('');
        setEvalVars([]);
        setPositiveClass('');
        setRocResults({});
        setMissingDataSummary(null);
        setUserCutoff(null);
      },
    });
  };

  const handleOutcomeVarChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setOutcomeVar(val);
    if (val) {
      // Remove outcome variable from evaluation variables if it was selected
      setEvalVars(prev => prev.filter(v => v !== val));
      
      const uniqueVals = Array.from(new Set(data.map(row => row[val]))).filter(v => v !== null && v !== undefined && v !== '');
      if (uniqueVals.length > 0) {
        setPositiveClass(String(uniqueVals[0]));
      } else {
        setPositiveClass('');
      }
    } else {
      setPositiveClass('');
    }
  };

  const handleSelectAllEvalVars = () => {
    const availableVars = columns.filter(col => col !== outcomeVar);
    const allSelected = availableVars.length > 0 && availableVars.every(v => evalVars.includes(v));
    
    if (allSelected) {
      setEvalVars([]);
    } else {
      setEvalVars(availableVars);
    }
  };

  const validateVariables = useCallback(() => {
    if (!outcomeVar || evalVars.length === 0 || !positiveClass) {
      setWarning('Please select outcome, positive class, and at least one evaluation variable.');
      return false;
    }

    // Check if outcome is binary
    const outcomeValues = new Set(data.map((row) => row[outcomeVar]));
    const validOutcomeValues = Array.from(outcomeValues).filter(
      (val) => {
        if (val === null || val === undefined || val === '') return false;
        const upperVal = String(val).trim().toUpperCase();
        return upperVal !== 'NA' && upperVal !== 'NAN' && upperVal !== 'N/A';
      }
    );

    if (validOutcomeValues.length !== 2) {
      setWarning(`Outcome variable must be binary (found ${validOutcomeValues.length} unique values).`);
      return false;
    }

    // Check if eval vars are continuous (numeric)
    for (const ev of evalVars) {
      const isContinuous = data.every(
        (row) => {
          const val = row[ev];
          if (val === null || val === undefined || val === '') return true;
          if (typeof val === 'string') {
            const upperVal = val.trim().toUpperCase();
            if (upperVal === 'NA' || upperVal === 'NAN' || upperVal === 'N/A') return true;
          }
          if (typeof val === 'number') return true;
          if (typeof val === 'string' && !isNaN(Number(val))) return true;
          return false;
        }
      );

      if (!isContinuous) {
        setWarning(`Evaluation variable "${ev}" must be continuous (numeric).`);
        return false;
      }
    }

    setWarning(null);
    return true;
  }, [data, outcomeVar, evalVars, positiveClass]);

  const handleCalculate = () => {
    if (!validateVariables()) return;

    const outcomeValues = Array.from(new Set(data.map((row) => row[outcomeVar]))).filter(
      (val) => {
        if (val === null || val === undefined || val === '') return false;
        const upperVal = String(val).trim().toUpperCase();
        return upperVal !== 'NA' && upperVal !== 'NAN' && upperVal !== 'N/A';
      }
    );
    
    const actualPositiveClass = outcomeValues.find(v => String(v) === positiveClass) ?? positiveClass;

    const newResults: Record<string, RocResult> = {};
    const newMissingSummary: Record<string, { total: number, valid: number, missing: number }> = {};

    for (const ev of evalVars) {
      const validData = data.filter(
        (row) => {
          const evVal = row[ev];
          const outVal = row[outcomeVar];
          
          const isMissing = (val: any) => {
            if (val === null || val === undefined || val === '') return true;
            const upperVal = String(val).trim().toUpperCase();
            return upperVal === 'NA' || upperVal === 'NAN' || upperVal === 'N/A';
          };

          const isEvMissing = isMissing(evVal);
          const isOutMissing = isMissing(outVal);
          return !isEvMissing && !isOutMissing;
        }
      );

      newMissingSummary[ev] = {
        total: data.length,
        valid: validData.length,
        missing: data.length - validData.length
      };

      const evalData = validData.map((row) => Number(row[ev]));
      const labelData = validData.map((row) => (row[outcomeVar] === actualPositiveClass ? 1 : 0));

      const result = calculateOptimalRoc(evalData, labelData, 1, true);
      newResults[ev] = {
        ...result,
        evalData,
        labelData
      };
    }

    setRocResults(newResults);
    setMissingDataSummary(newMissingSummary);
    setMultiOverrides({});
    
    if (evalVars.length === 1 && newResults[evalVars[0]]) {
      setUserCutoff(newResults[evalVars[0]].optimalCutoff);
    } else {
      setUserCutoff(null);
    }
  };

  const selectedResultEntries = useMemo(() => {
    return evalVars
      .map((key) => {
        const result = rocResults[key];
        return result ? ([key, result] as const) : null;
      })
      .filter((entry): entry is readonly [string, RocResult] => entry !== null);
  }, [evalVars, rocResults]);

  const hasResults = evalVars.length > 0 && selectedResultEntries.length === evalVars.length;
  const isSingle = hasResults && selectedResultEntries.length === 1;
  const isMulti = hasResults && selectedResultEntries.length > 1;
  const singleResultEntry = isSingle ? selectedResultEntries[0] : null;
  const singleResultKey = singleResultEntry?.[0] ?? '';
  const singleResult = singleResultEntry?.[1] ?? null;
  const selectedMissingDataEntries = useMemo(() => {
    if (!missingDataSummary || !hasResults) return [];
    return evalVars
      .map((key) => {
        const summary = missingDataSummary[key];
        return summary ? ([key, summary] as const) : null;
      })
      .filter((entry): entry is readonly [string, { total: number; valid: number; missing: number }] => entry !== null);
  }, [evalVars, hasResults, missingDataSummary]);

  const currentSingleMetrics = useMemo(() => {
    if (!singleResultEntry || userCutoff === null || !outcomeVar || !positiveClass) return null;
    
    const [ev, result] = singleResultEntry;

    const outcomeValues = Array.from(new Set(data.map((row) => row[outcomeVar]))).filter(
      (val) => {
        if (val === null || val === undefined || val === '') return false;
        const upperVal = String(val).trim().toUpperCase();
        return upperVal !== 'NA' && upperVal !== 'NAN' && upperVal !== 'N/A';
      }
    );
    const actualPositiveClass = outcomeValues.find(v => String(v) === positiveClass) ?? positiveClass;

    const validData = data.filter(
      (row) => {
        const evVal = row[ev];
        const outVal = row[outcomeVar];
        
        const isMissing = (val: any) => {
          if (val === null || val === undefined || val === '') return true;
          const upperVal = String(val).trim().toUpperCase();
          return upperVal === 'NA' || upperVal === 'NAN' || upperVal === 'N/A';
        };

        const isEvMissing = isMissing(evVal);
        const isOutMissing = isMissing(outVal);
        return !isEvMissing && !isOutMissing;
      }
    );

    const evalData = validData.map((row) => Number(row[ev]));
    const labelData = validData.map((row) => (row[outcomeVar] === actualPositiveClass ? 1 : 0));

    return calculateMetricsAtCutoff(evalData, labelData, userCutoff, 1, result.direction);
  }, [data, outcomeVar, singleResultEntry, userCutoff, positiveClass]);

  const minEval = useMemo(() => {
    if (!data.length || evalVars.length !== 1) return 0;
    const ev = evalVars[0];
    const vals = data.map((d) => Number(d[ev])).filter((v) => !isNaN(v));
    return vals.length ? Math.min(...vals) : 0;
  }, [data, evalVars]);

  const maxEval = useMemo(() => {
    if (!data.length || evalVars.length !== 1) return 100;
    const ev = evalVars[0];
    const vals = data.map((d) => Number(d[ev])).filter((v) => !isNaN(v));
    return vals.length ? Math.max(...vals) : 100;
  }, [data, evalVars]);

  const handleDownloadPlot = useCallback((format: 'png' | 'jpeg' | 'svg' | 'pdf') => {
    if (chartRef.current === null) {
      return;
    }

    const node = chartRef.current;
    const width = node.offsetWidth;
    const height = node.offsetHeight;
    const scale = 3; // Increase resolution by 3x

    const options = { 
      quality: 1, 
      backgroundColor: '#ffffff', 
      width: width * scale,
      height: height * scale,
      style: {
        transform: `scale(${scale})`,
        transformOrigin: 'top left',
        width: `${width}px`,
        height: `${height}px`,
      }
    };

    const download = (dataUrl: string, ext: string) => {
      const link = document.createElement('a');
      link.download = `roc-plot.${ext}`;
      link.href = dataUrl;
      link.click();
    };

    if (format === 'png') {
      toPng(node, options).then((dataUrl) => download(dataUrl, 'png'));
    } else if (format === 'jpeg') {
      toJpeg(node, options).then((dataUrl) => download(dataUrl, 'jpeg'));
    } else if (format === 'svg') {
      toSvg(node, options).then((dataUrl) => download(dataUrl, 'svg'));
    } else if (format === 'pdf') {
      toPng(node, options).then((dataUrl) => {
        const pdf = new jsPDF({
          orientation: width > height ? 'landscape' : 'portrait',
          unit: 'px',
          format: [width, height]
        });
        pdf.addImage(dataUrl, 'PNG', 0, 0, width, height);
        pdf.save('roc-plot.pdf');
      });
    }
  }, [chartRef]);

  const handleExportMetrics = useCallback(() => {
    if (isSingle && currentSingleMetrics && singleResultEntry) {
      const [singleKey, singleResult] = singleResultEntry;
      const csvContent = [
        ['Metric', 'Value'],
        ['Variable', singleKey],
        ['Accuracy', (currentSingleMetrics.accuracy * 100).toFixed(2)],
        ['Sensitivity (TPR)', (currentSingleMetrics.sensitivity * 100).toFixed(2)],
        ['Specificity (TNR)', (currentSingleMetrics.specificity * 100).toFixed(2)],
        ['Positive Predictive Value (PPV)', (currentSingleMetrics.ppv * 100).toFixed(2)],
        ['Negative Predictive Value (NPV)', (currentSingleMetrics.npv * 100).toFixed(2)],
        ['F1 Score', currentSingleMetrics.f1.toFixed(4)],
        ['Youden\'s Index (J)', currentSingleMetrics.youdenJ.toFixed(4)],
        ['True Positives (TP)', currentSingleMetrics.tp],
        ['False Positives (FP)', currentSingleMetrics.fp],
        ['False Negatives (FN)', currentSingleMetrics.fn],
        ['True Negatives (TN)', currentSingleMetrics.tn],
        ['Area Under Curve (AUC)', `${singleResult.auc.toFixed(4)} (95% CI: ${singleResult.aucCi ? `${singleResult.aucCi.lowerBound.toFixed(4)} - ${singleResult.aucCi.upperBound.toFixed(4)}` : 'N/A'})`],
        ['Optimal Cutoff (Youden)', singleResult.optimalCutoff.toFixed(4)],
        ['Max Youden\'s Index (J)', singleResult.maxYoudenJ.toFixed(4)],
      ].map(e => e.join(",")).join("\n");

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement("a");
      const url = URL.createObjectURL(blob);
      link.setAttribute("href", url);
      link.setAttribute("download", "roc_metrics.csv");
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else if (isMulti) {
      const csvContent = [
        ['Variable', 'AUC', 'AUC 95% CI', 'Cutoff', 'Direction', 'Accuracy', 'Sensitivity', 'Specificity', 'PPV', 'NPV', 'F1 Score', 'Youden Index'],
        ...selectedResultEntries.map(([key, result]) => {
          const override = multiOverrides[key];
          const currentCutoff = override ? override.cutoff : result.optimalCutoff;
          const currentDirection = override ? override.direction : result.direction;
          const displayMetrics = override 
            ? calculateMetricsForCutoff(result.evalData, result.labelData, currentCutoff, currentDirection)
            : result.optimalMetrics;
          
          return [
            key,
            result.auc.toFixed(4),
            result.aucCi ? `[${result.aucCi.lowerBound.toFixed(4)} - ${result.aucCi.upperBound.toFixed(4)}]` : 'N/A',
            currentCutoff.toFixed(4),
            currentDirection === 'gt' ? '>' : '<',
            (displayMetrics.accuracy * 100).toFixed(2),
            (displayMetrics.sensitivity * 100).toFixed(2),
            (displayMetrics.specificity * 100).toFixed(2),
            (displayMetrics.ppv * 100).toFixed(2),
            (displayMetrics.npv * 100).toFixed(2),
            displayMetrics.f1.toFixed(4),
            displayMetrics.youdenJ.toFixed(4)
          ];
        })
      ].map(e => e.join(",")).join("\n");

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement("a");
      const url = URL.createObjectURL(blob);
      link.setAttribute("href", url);
      link.setAttribute("download", "roc_comparison_metrics.csv");
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  }, [currentSingleMetrics, isSingle, isMulti, multiOverrides, selectedResultEntries, singleResultEntry]);

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 flex flex-col">
      <header className="bg-blue-700 text-white py-8 px-8 shadow-sm">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center shadow-inner">
              <Activity className="w-7 h-7 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight">ROC Analysis Tool</h1>
              <p className="text-blue-100 text-sm mt-1 font-medium">
                Evaluate diagnostic value & optimal cutoffs using Youden's Index
              </p>
            </div>
          </div>
          <nav className="flex bg-blue-800/50 p-1 rounded-lg self-start md:self-center">
            <button
              onClick={() => setActiveTab('analysis')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                activeTab === 'analysis'
                  ? 'bg-white text-blue-700 shadow-sm'
                  : 'text-blue-100 hover:text-white hover:bg-white/10'
              }`}
            >
              Analysis
            </button>
            <button
              onClick={() => setActiveTab('about')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-all ${
                activeTab === 'about'
                  ? 'bg-white text-blue-700 shadow-sm'
                  : 'text-blue-100 hover:text-white hover:bg-white/10'
              }`}
            >
              About
            </button>
          </nav>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-8 py-8 space-y-8 flex-grow w-full">
        {activeTab === 'analysis' ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Controls Section */}
          <div className="lg:col-span-1 space-y-6">
            <div className="bg-white p-6 rounded-xl shadow-sm border border-blue-100/50">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2 text-blue-900">
                <UploadCloud className="w-5 h-5 text-blue-600" />
                Data Input
              </h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Upload Dataset (CSV, TXT)
                  </label>
                  <div className="relative">
                    <input
                      type="file"
                      id="file-upload"
                      accept=".csv,.txt"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                    <label
                      htmlFor="file-upload"
                      className="flex items-center w-full p-2 border border-slate-300 rounded-md cursor-pointer hover:bg-slate-50 transition-colors"
                    >
                      <span className="bg-blue-50 text-blue-700 py-1.5 px-3 rounded-md text-sm font-semibold hover:bg-blue-100 transition-colors mr-3 whitespace-nowrap">
                        Choose file
                      </span>
                      <span className="text-sm text-slate-500 truncate">
                        {fileName || "No file chosen"}
                      </span>
                    </label>
                  </div>
                </div>

                {error && (
                  <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm flex items-start gap-2 border border-red-100">
                    <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                    <p>{error}</p>
                  </div>
                )}

                {columns.length > 0 && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        Outcome Variable (Binary)
                      </label>
                      <select
                        value={outcomeVar}
                        onChange={handleOutcomeVarChange}
                        className="w-full rounded-lg border-slate-300 border p-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
                      >
                        <option value="">Select variable...</option>
                        {columns.map((col) => (
                          <option key={col} value={col}>
                            {col}
                          </option>
                        ))}
                      </select>
                    </div>

                    {outcomeVar && (
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">
                          Positive Class (Target)
                        </label>
                        <select
                          value={positiveClass}
                          onChange={(e) => setPositiveClass(e.target.value)}
                          className="w-full rounded-lg border-slate-300 border p-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
                        >
                          {Array.from(new Set(data.map(row => row[outcomeVar]))).filter(val => val !== null && val !== undefined && val !== '').map((val: any) => (
                            <option key={String(val)} value={String(val)}>
                              {String(val)}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-sm font-medium text-slate-700">
                          Evaluation Variables (Continuous)
                        </label>
                        <button
                          type="button"
                          onClick={handleSelectAllEvalVars}
                          className="text-xs text-blue-600 hover:text-blue-800 font-medium transition-colors"
                        >
                          {columns.filter(col => col !== outcomeVar).length > 0 && 
                           columns.filter(col => col !== outcomeVar).every(v => evalVars.includes(v)) 
                           ? 'Deselect All' : 'Select All'}
                        </button>
                      </div>
                      <div className="max-h-48 overflow-y-auto border border-slate-300 rounded-lg p-2 bg-white space-y-1">
                        {columns.filter(col => col !== outcomeVar).map((col) => (
                          <label key={col} className="flex items-center space-x-2 p-1.5 hover:bg-slate-50 rounded cursor-pointer">
                            <input
                              type="checkbox"
                              checked={evalVars.includes(col)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setEvalVars([...evalVars, col]);
                                } else {
                                  setEvalVars(evalVars.filter(v => v !== col));
                                }
                              }}
                              className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                            />
                            <span className="text-sm text-slate-700">{col}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    {warning && (
                      <div className="p-3 bg-amber-50 text-amber-700 rounded-lg text-sm flex items-start gap-2 border border-amber-100">
                        <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                        <p>{warning}</p>
                      </div>
                    )}

                    <button
                      onClick={handleCalculate}
                      disabled={!outcomeVar || evalVars.length === 0}
                      className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-sm"
                    >
                      Calculate ROC
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </>
                )}
              </div>
            </div>

            {isSingle && singleResult && (
              <div className="bg-white p-6 rounded-xl shadow-sm border border-blue-100/50">
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2 text-blue-900">
                  <CheckCircle2 className="w-5 h-5 text-blue-600" />
                  Summary
                </h2>
                <div className="space-y-3">
                  <div className="flex justify-between items-center p-3 bg-blue-50/50 rounded-lg border border-blue-100/50">
                    <span className="text-sm font-medium text-blue-900">Area Under Curve (AUC)</span>
                    <div className="text-right">
                      <div className="font-bold text-blue-700">
                        {singleResult.auc.toFixed(4)}
                      </div>
                      {singleResult.aucCi && (
                        <div className="text-xs text-blue-600/80 mt-0.5">
                          95% CI: {singleResult.aucCi.lowerBound.toFixed(4)} - {singleResult.aucCi.upperBound.toFixed(4)}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-blue-50/50 rounded-lg border border-blue-100/50">
                    <span className="text-sm font-medium text-blue-900">Direction</span>
                    <select
                      value={singleResult.direction}
                      onChange={(e) => handleDirectionChange(singleResultKey, e.target.value as 'gt' | 'lt')}
                      className="text-sm font-bold text-blue-700 bg-transparent border-none focus:ring-0 cursor-pointer"
                    >
                      <option value="gt">Greater (&gt;)</option>
                      <option value="lt">Less (&lt;)</option>
                    </select>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-blue-50/50 rounded-lg border border-blue-100/50">
                    <span className="text-sm font-medium text-blue-900">Optimal Cutoff (Youden)</span>
                    <span className="font-bold text-blue-700">
                      {singleResult.optimalCutoff.toFixed(4)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center p-3 bg-blue-50/50 rounded-lg border border-blue-100/50">
                    <span className="text-sm font-medium text-blue-900">Max Youden's Index (J)</span>
                    <span className="font-bold text-blue-700">
                      {singleResult.maxYoudenJ.toFixed(4)}
                    </span>
                  </div>
                </div>
                <div className="mt-4 text-xs text-slate-500 italic">
                  * 95% Confidence Intervals were calculated via DeLong's method.
                </div>
              </div>
            )}
          </div>

          {/* Results Section */}
          <div className="lg:col-span-2 space-y-6">
            {hasResults ? (
              <>
                <div className="bg-white p-6 rounded-xl shadow-sm border border-blue-100/50">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-4">
                    <h2 className="text-lg font-semibold text-blue-900">
                      {isSingle ? 'ROC Curve' : 'Multiple ROC Comparison'}
                    </h2>
                    <div className="flex items-center gap-2">
                      <button onClick={() => handleDownloadPlot('pdf')} className="text-xs flex items-center gap-1 bg-slate-100 hover:bg-slate-200 text-slate-700 px-2.5 py-1.5 rounded-md transition-colors font-medium border border-slate-200 shadow-sm">
                        <FileText className="w-3.5 h-3.5" /> PDF
                      </button>
                      <button onClick={() => handleDownloadPlot('png')} className="text-xs flex items-center gap-1 bg-slate-100 hover:bg-slate-200 text-slate-700 px-2.5 py-1.5 rounded-md transition-colors font-medium border border-slate-200 shadow-sm">
                        <ImageIcon className="w-3.5 h-3.5" /> PNG
                      </button>
                      <button onClick={() => handleDownloadPlot('jpeg')} className="text-xs flex items-center gap-1 bg-slate-100 hover:bg-slate-200 text-slate-700 px-2.5 py-1.5 rounded-md transition-colors font-medium border border-slate-200 shadow-sm">
                        <ImageIcon className="w-3.5 h-3.5" /> JPEG
                      </button>
                      <button onClick={() => handleDownloadPlot('svg')} className="text-xs flex items-center gap-1 bg-slate-100 hover:bg-slate-200 text-slate-700 px-2.5 py-1.5 rounded-md transition-colors font-medium border border-slate-200 shadow-sm">
                        <ImageIcon className="w-3.5 h-3.5" /> SVG
                      </button>
                    </div>
                  </div>
                  <div className="bg-white p-12 rounded-xl border border-slate-100 shadow-sm" ref={chartRef}>
                    <div className="flex flex-col md:flex-row items-center justify-center gap-6">
                      <div className="aspect-square w-full max-w-[500px] relative shrink-0">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart margin={{ top: 20, right: 20, left: 80, bottom: 10 }}>
                            <XAxis
                              dataKey="fpr"
                              type="number"
                              domain={[0, 1]}
                              tickCount={6}
                              label={{ 
                                value: 'False Positive Rate (1 - Specificity)', 
                                position: 'insideBottom', 
                                offset: 5, 
                                fill: '#1e293b', 
                                fontSize: 14,
                                fontFamily: '"Times New Roman", Times, serif'
                              }}
                              tick={{ fontSize: 12, fill: '#64748b' }}
                              height={50}
                            />
                            <YAxis
                              dataKey="tpr"
                              type="number"
                              domain={[0, 1]}
                              tickCount={6}
                              label={{ 
                                value: 'True Positive Rate (Sensitivity)', 
                                angle: -90, 
                                position: 'insideLeft', 
                                offset: 10, 
                                fill: '#1e293b', 
                                fontSize: 14,
                                fontFamily: '"Times New Roman", Times, serif',
                                style: { textAnchor: 'middle' }
                              }}
                              tick={{ fontSize: 12, fill: '#64748b' }}
                              width={60}
                            />
                            <Tooltip
                              formatter={(value: number, name: string) => [value.toFixed(4), name]}
                              labelFormatter={(label) => `FPR: ${Number(label).toFixed(4)}`}
                              contentStyle={{ borderRadius: '8px', border: '1px solid #bfdbfe', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}
                            />
                            <ReferenceLine
                              segment={[{ x: 0, y: 0 }, { x: 1, y: 1 }]}
                              stroke="#94a3b8"
                              strokeDasharray="3 3"
                            />
                            {selectedResultEntries.map(([key, result], index) => (
                              <Line
                                key={key}
                                data={result.points}
                                type="stepAfter"
                                dataKey="tpr"
                                name={key}
                                stroke={COLORS[index % COLORS.length]}
                                strokeWidth={3}
                                dot={false}
                                activeDot={{ r: 6, strokeWidth: 2 }}
                              />
                            ))}
                            {selectedResultEntries.map(([key, result], index) => {
                              const optimalPoint = result.points.find((p: RocPoint) => p.cutoff === result.optimalCutoff);
                              if (!optimalPoint) return null;
                              return (
                                <ReferenceDot 
                                  key={`dot-${key}`}
                                  x={optimalPoint.fpr} 
                                  y={optimalPoint.tpr} 
                                  r={6} 
                                  fill={COLORS[index % COLORS.length]} 
                                  stroke="#fff" 
                                  strokeWidth={2} 
                                />
                              );
                            })}
                          </LineChart>
                        </ResponsiveContainer>
                      </div>

                      {/* Side Legend */}
                      <div className="flex flex-col gap-4 min-w-[240px] py-4 self-start md:self-center">
                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 border-b border-slate-100 pb-2">
                          Variables & AUC
                        </div>
                        <div className="space-y-4">
                          {selectedResultEntries.map(([key, result], index) => (
                            <div key={key} className="flex items-start gap-3 group">
                              <div 
                                className="w-3.5 h-3.5 rounded-full shrink-0 mt-0.5 shadow-sm border-2 border-white" 
                                style={{ backgroundColor: COLORS[index % COLORS.length] }}
                              />
                              <div className="flex flex-col min-w-0">
                                <span className="text-sm font-bold text-slate-800 leading-tight" title={key}>
                                  {key}
                                </span>
                                <div className="flex items-center gap-2 mt-1">
                                  <span className="text-[11px] font-medium text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">
                                    AUC: {result.auc.toFixed(4)}
                                  </span>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {isSingle && currentSingleMetrics && (
                  <div className="bg-white p-6 rounded-xl shadow-sm border border-blue-100/50">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-4">
                      <div className="flex items-center gap-3">
                        <h2 className="text-lg font-semibold text-blue-900">Parameter Table</h2>
                        <button onClick={handleExportMetrics} className="text-xs flex items-center gap-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 px-3 py-1.5 rounded-md transition-colors font-medium border border-blue-200 shadow-sm">
                          <FileDown className="w-4 h-4" /> Export CSV
                        </button>
                      </div>
                      <div className="flex items-center gap-3">
                        <label className="text-sm font-medium text-slate-700 whitespace-nowrap">
                          Cutoff Value:
                        </label>
                        <input
                          type="number"
                          value={userCutoff !== null ? userCutoff : ''}
                          onChange={(e) => setUserCutoff(Number(e.target.value))}
                          step="0.01"
                          className="w-24 rounded-lg border-slate-300 border p-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
                        />
                      </div>
                    </div>

                    <div className="mb-6">
                      <input
                        type="range"
                        min={minEval}
                        max={maxEval}
                        step={(maxEval - minEval) / 1000}
                        value={userCutoff !== null ? userCutoff : minEval}
                        onChange={(e) => setUserCutoff(Number(e.target.value))}
                        className="w-full h-2 bg-blue-100 rounded-lg appearance-none cursor-pointer accent-blue-600"
                      />
                      <div className="flex justify-between text-xs text-slate-500 mt-2 font-medium">
                        <span>Min: {minEval.toFixed(2)}</span>
                        <span>Max: {maxEval.toFixed(2)}</span>
                      </div>
                    </div>

                    <div className="overflow-x-auto rounded-lg border border-blue-100/50">
                      <table className="w-full text-sm text-left text-slate-600">
                        <thead className="text-xs text-blue-900 uppercase bg-blue-50/80">
                          <tr>
                            <th className="px-4 py-3">Metric</th>
                            <th className="px-4 py-3">Value</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr className="border-b border-blue-50">
                            <td className="px-4 py-3 font-medium text-slate-900">Accuracy</td>
                            <td className="px-4 py-3">{(currentSingleMetrics.accuracy * 100).toFixed(2)}</td>
                          </tr>
                          <tr className="border-b border-blue-50">
                            <td className="px-4 py-3 font-medium text-slate-900">Sensitivity (TPR)</td>
                            <td className="px-4 py-3">{(currentSingleMetrics.sensitivity * 100).toFixed(2)}</td>
                          </tr>
                          <tr className="border-b border-blue-50">
                            <td className="px-4 py-3 font-medium text-slate-900">Specificity (TNR)</td>
                            <td className="px-4 py-3">{(currentSingleMetrics.specificity * 100).toFixed(2)}</td>
                          </tr>
                          <tr className="border-b border-blue-50">
                            <td className="px-4 py-3 font-medium text-slate-900">Positive Predictive Value (PPV)</td>
                            <td className="px-4 py-3">{(currentSingleMetrics.ppv * 100).toFixed(2)}</td>
                          </tr>
                          <tr className="border-b border-blue-50">
                            <td className="px-4 py-3 font-medium text-slate-900">Negative Predictive Value (NPV)</td>
                            <td className="px-4 py-3">{(currentSingleMetrics.npv * 100).toFixed(2)}</td>
                          </tr>
                          <tr className="border-b border-blue-50">
                            <td className="px-4 py-3 font-medium text-slate-900">F1 Score</td>
                            <td className="px-4 py-3">{currentSingleMetrics.f1.toFixed(4)}</td>
                          </tr>
                          <tr className="border-b border-blue-50">
                            <td className="px-4 py-3 font-medium text-slate-900">Youden's Index (J)</td>
                            <td className="px-4 py-3">{currentSingleMetrics.youdenJ.toFixed(4)}</td>
                          </tr>
                          <tr className="bg-blue-50/30">
                            <td className="px-4 py-3 font-medium text-slate-900">Confusion Matrix</td>
                            <td className="px-4 py-3">
                              <div className="grid grid-cols-2 gap-2 text-xs font-medium">
                                <div className="bg-white p-1.5 rounded border border-blue-100 text-blue-800">TP: {currentSingleMetrics.tp}</div>
                                <div className="bg-white p-1.5 rounded border border-blue-100 text-slate-600">FP: {currentSingleMetrics.fp}</div>
                                <div className="bg-white p-1.5 rounded border border-blue-100 text-slate-600">FN: {currentSingleMetrics.fn}</div>
                                <div className="bg-white p-1.5 rounded border border-blue-100 text-blue-800">TN: {currentSingleMetrics.tn}</div>
                              </div>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {isMulti && (
                  <div className="bg-white p-6 rounded-xl shadow-sm border border-blue-100/50">
                    <div className="flex items-center justify-between mb-6">
                      <h2 className="text-lg font-semibold text-blue-900">Comparison Table</h2>
                      <button onClick={handleExportMetrics} className="text-xs flex items-center gap-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 px-3 py-1.5 rounded-md transition-colors font-medium border border-blue-200 shadow-sm">
                        <FileDown className="w-4 h-4" /> Export CSV
                      </button>
                    </div>
                    <div className="overflow-x-auto rounded-lg border border-blue-100/50">
                      <table className="w-full text-sm text-left text-slate-600">
                        <thead className="text-xs text-blue-900 uppercase bg-blue-50/80">
                          <tr>
                            <th className="px-4 py-3">Variable</th>
                            <th className="px-4 py-3">AUC</th>
                            <th className="px-4 py-3">95% CI</th>
                            <th className="px-4 py-3">Cutoff</th>
                            <th className="px-4 py-3">Direction</th>
                            <th className="px-4 py-3">Accuracy</th>
                            <th className="px-4 py-3">Sensitivity</th>
                            <th className="px-4 py-3">Specificity</th>
                            <th className="px-4 py-3">PPV</th>
                            <th className="px-4 py-3">NPV</th>
                            <th className="px-4 py-3">F1</th>
                            <th className="px-4 py-3">Youden</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedResultEntries.map(([key, result], index) => {
                            const override = multiOverrides[key];
                            const currentCutoff = override ? override.cutoff : result.optimalCutoff;
                            const currentDirection = override ? override.direction : result.direction;
                            
                            const displayMetrics = override 
                              ? calculateMetricsForCutoff(result.evalData, result.labelData, currentCutoff, currentDirection)
                              : result.optimalMetrics;

                            return (
                              <tr key={key} className="border-b border-blue-50 hover:bg-slate-50">
                                <td className="px-4 py-3 font-medium text-slate-900 flex items-center gap-2">
                                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }}></div>
                                  {key}
                                </td>
                                <td className="px-4 py-3 font-bold text-blue-700">
                                  {result.auc.toFixed(4)}
                                </td>
                                <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                                  [{result.aucCi?.lowerBound.toFixed(4)} - {result.aucCi?.upperBound.toFixed(4)}]
                                </td>
                                <td className="px-4 py-3">
                                  <input 
                                    type="number" 
                                    step="any"
                                    value={currentCutoff}
                                    onChange={(e) => handleCutoffChange(key, Number(e.target.value))}
                                    className="w-24 px-2 py-1 border border-blue-100 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm"
                                  />
                                </td>
                                <td className="px-4 py-3">
                                  <select
                                    value={currentDirection}
                                    onChange={(e) => handleDirectionChange(key, e.target.value as 'gt' | 'lt')}
                                    className="px-2 py-1 border border-blue-100 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-sm"
                                  >
                                    <option value="gt">&gt;</option>
                                    <option value="lt">&lt;</option>
                                  </select>
                                </td>
                                <td className="px-4 py-3">{(displayMetrics.accuracy * 100).toFixed(2)}</td>
                                <td className="px-4 py-3">{(displayMetrics.sensitivity * 100).toFixed(2)}</td>
                                <td className="px-4 py-3">{(displayMetrics.specificity * 100).toFixed(2)}</td>
                                <td className="px-4 py-3">{(displayMetrics.ppv * 100).toFixed(2)}</td>
                                <td className="px-4 py-3">{(displayMetrics.npv * 100).toFixed(2)}</td>
                                <td className="px-4 py-3">{displayMetrics.f1.toFixed(4)}</td>
                                <td className="px-4 py-3">{displayMetrics.youdenJ.toFixed(4)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div className="mt-4 text-xs text-slate-500 italic">
                      * 95% Confidence Intervals were calculated via DeLong's method.
                    </div>
                  </div>
                )}

                {selectedMissingDataEntries.length > 0 && (
                  <div className="bg-white p-6 rounded-xl shadow-sm border border-blue-100/50">
                    <h2 className="text-lg font-semibold mb-6 text-blue-900">Missing Data Summary</h2>
                    <div className="overflow-x-auto rounded-lg border border-blue-100/50">
                      <table className="w-full text-sm text-left text-slate-600">
                        <thead className="text-xs text-blue-900 uppercase bg-blue-50/80">
                          <tr>
                            <th className="px-4 py-3">Variable</th>
                            <th className="px-4 py-3 text-right">Total Rows</th>
                            <th className="px-4 py-3 text-right">Valid Rows</th>
                            <th className="px-4 py-3 text-right">Dropped (Missing)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedMissingDataEntries.map(([key, summary]) => (
                            <tr key={key} className="border-b border-blue-50 hover:bg-slate-50">
                              <td className="px-4 py-3 font-medium text-slate-900">{key}</td>
                              <td className="px-4 py-3 text-right">{summary.total}</td>
                              <td className="px-4 py-3 text-right">{summary.valid}</td>
                              <td className="px-4 py-3 text-right font-medium text-red-600">{summary.missing}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="bg-white p-12 rounded-xl shadow-sm border border-blue-100/50 flex flex-col items-center justify-center text-center h-full min-h-[400px]">
                <div className="w-20 h-20 bg-blue-50 rounded-full flex items-center justify-center mb-5">
                  <UploadCloud className="w-10 h-10 text-blue-500" />
                </div>
                <h3 className="text-xl font-semibold text-blue-900 mb-2">No Data Analyzed</h3>
                <p className="text-slate-500 max-w-md">
                  Upload a CSV or TXT file and select your variables on the left to generate an ROC curve and parameter table.
                </p>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="max-w-4xl mx-auto space-y-12 py-4">
          <section className="text-center space-y-4">
            <h2 className="text-3xl font-bold text-slate-900">About ROC Analysis Tool</h2>
            <p className="text-lg text-slate-600 max-w-2xl mx-auto">
              A comprehensive, professional-grade web application designed for researchers and clinicians to evaluate diagnostic performance with precision.
            </p>
          </section>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 space-y-4">
              <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center">
                <Database className="w-5 h-5 text-blue-600" />
              </div>
              <h3 className="text-xl font-semibold text-slate-900">1. Data Management & Input</h3>
              <ul className="space-y-2 text-slate-600 text-sm">
                <li className="flex items-start gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-1.5 shrink-0" />
                  <span><strong>Flexible File Upload:</strong> Supports dataset uploads in CSV and TXT formats.</span>
                </li>
                <li className="flex items-start gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-1.5 shrink-0" />
                  <span><strong>Variable Selection:</strong> Easily map your data by selecting the Outcome Variable (Binary) and Evaluation Variables.</span>
                </li>
                <li className="flex items-start gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-1.5 shrink-0" />
                  <span><strong>Missing Data Handling:</strong> Automatically detects and summarizes missing values for data integrity.</span>
                </li>
              </ul>
            </div>

            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 space-y-4">
              <div className="w-10 h-10 bg-emerald-50 rounded-lg flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-emerald-600" />
              </div>
              <h3 className="text-xl font-semibold text-slate-900">2. Advanced ROC Analysis</h3>
              <ul className="space-y-2 text-slate-600 text-sm">
                <li className="flex items-start gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-1.5 shrink-0" />
                  <span><strong>Single Variable Analysis:</strong> Detailed breakdown with an interactive Cutoff Slider for real-time metric updates.</span>
                </li>
                <li className="flex items-start gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-1.5 shrink-0" />
                  <span><strong>Multiple Variable Comparison:</strong> Compare diagnostic performance of multiple variables on a single chart.</span>
                </li>
                <li className="flex items-start gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-1.5 shrink-0" />
                  <span><strong>Optimal Cutoff Discovery:</strong> Automated calculation using Youden’s Index to maximize Sensitivity & Specificity.</span>
                </li>
              </ul>
            </div>

            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 space-y-4">
              <div className="w-10 h-10 bg-amber-50 rounded-lg flex items-center justify-center">
                <Calculator className="w-5 h-5 text-amber-600" />
              </div>
              <h3 className="text-xl font-semibold text-slate-900">3. Comprehensive Metrics</h3>
              <ul className="space-y-2 text-slate-600 text-sm">
                <li className="flex items-start gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-amber-400 mt-1.5 shrink-0" />
                  <span><strong>Core Statistics:</strong> AUC (Area Under Curve), Optimal Cutoff, and Youden's Index.</span>
                </li>
                <li className="flex items-start gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-amber-400 mt-1.5 shrink-0" />
                  <span><strong>Performance Indicators:</strong> Real-time Accuracy, Sensitivity (TPR), Specificity (TNR), PPV, NPV, and F1 Score.</span>
                </li>
                <li className="flex items-start gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-amber-400 mt-1.5 shrink-0" />
                  <span><strong>Confusion Matrix:</strong> Visualizes True Positives (TP), False Positives (FP), False Negatives (FN), and True Negatives (TN).</span>
                </li>
              </ul>
            </div>

            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 space-y-4">
              <div className="w-10 h-10 bg-purple-50 rounded-lg flex items-center justify-center">
                <FileText className="w-5 h-5 text-purple-600" />
              </div>
              <h3 className="text-xl font-semibold text-slate-900">4. Visualization & Export</h3>
              <ul className="space-y-2 text-slate-600 text-sm">
                <li className="flex items-start gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-purple-400 mt-1.5 shrink-0" />
                  <span><strong>High-Resolution Plotting:</strong> Dynamic ROC curves with consistent 1:1 aspect ratio scaling.</span>
                </li>
                <li className="flex items-start gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-purple-400 mt-1.5 shrink-0" />
                  <span><strong>Image & Document Export:</strong> Download plots in PNG, JPEG, SVG, or PDF at 3x resolution.</span>
                </li>
                <li className="flex items-start gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-purple-400 mt-1.5 shrink-0" />
                  <span><strong>Data Export:</strong> Export all calculated metrics and comparison results directly to CSV.</span>
                </li>
              </ul>
            </div>

            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 space-y-4">
              <div className="w-10 h-10 bg-indigo-50 rounded-lg flex items-center justify-center">
                <Layout className="w-5 h-5 text-indigo-600" />
              </div>
              <h3 className="text-xl font-semibold text-slate-900">5. Modern UI/UX</h3>
              <ul className="space-y-2 text-slate-600 text-sm">
                <li className="flex items-start gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 mt-1.5 shrink-0" />
                  <span><strong>Responsive Design:</strong> Clean, professional interface built with Tailwind CSS for all screen sizes.</span>
                </li>
                <li className="flex items-start gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 mt-1.5 shrink-0" />
                  <span><strong>Interactive Elements:</strong> Hoverable tooltips and real-time updates when adjusting parameters.</span>
                </li>
              </ul>
            </div>

            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 space-y-4">
              <div className="w-10 h-10 bg-rose-50 rounded-lg flex items-center justify-center">
                <ShieldCheck className="w-5 h-5 text-rose-600" />
              </div>
              <h3 className="text-xl font-semibold text-slate-900">6. Reliability & Precision</h3>
              <ul className="space-y-2 text-slate-600 text-sm">
                <li className="flex items-start gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-rose-400 mt-1.5 shrink-0" />
                  <span><strong>DeLong Method:</strong> 95% Confidence Intervals calculated via the standard DeLong's asymptotic method.</span>
                </li>
                <li className="flex items-start gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-rose-400 mt-1.5 shrink-0" />
                  <span><strong>Academic Standards:</strong> Follows standard diagnostic evaluation protocols for research and clinical use.</span>
                </li>
              </ul>
            </div>
          </div>

          <div className="bg-blue-50 p-8 rounded-2xl border border-blue-100 text-center space-y-6">
            <div className="space-y-2">
              <h3 className="text-2xl font-bold text-blue-900">Support the Project</h3>
              <p className="text-blue-700">If you find this tool useful, please consider giving it a star on GitHub!</p>
            </div>
            <a 
              href="https://github.com/Fusika1203/ROC-Analysis-Tool.git" 
              target="_blank" 
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-6 py-3 rounded-xl font-semibold transition-all shadow-lg hover:shadow-xl active:scale-95"
            >
              <Github className="w-5 h-5" />
              Give a Star
              <Star className="w-4 h-4 text-yellow-400 fill-yellow-400" />
            </a>
          </div>
        </div>
      )}
      </main>

      {/* Footer */}
      <footer className="mt-auto py-6 text-center text-sm text-slate-500 border-t border-slate-200 bg-white/50 backdrop-blur-sm">
        <p>M1461025 - Thanh Dat Nguyen, AI Department, Chang Gung University</p>
      </footer>
    </div>
  );
}
