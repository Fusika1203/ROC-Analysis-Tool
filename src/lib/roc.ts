export interface RocPoint {
  cutoff: number;
  tpr: number; // Sensitivity
  fpr: number; // 1 - Specificity
  tnr: number; // Specificity
  fnr: number; // 1 - Sensitivity
  tp: number;
  fp: number;
  tn: number;
  fn: number;
  youdenJ: number;
}

export interface RocMetrics {
  accuracy: number;
  sensitivity: number;
  specificity: number;
  ppv: number;
  npv: number;
  f1: number;
  youdenJ: number;
  tp: number;
  fp: number;
  tn: number;
  fn: number;
}

export function calculateDeLongCi(
  data: number[],
  labels: number[],
  auc: number,
  positiveLabel: number = 1,
  direction: 'gt' | 'lt' = 'gt'
): { lowerBound: number; upperBound: number } {
  const n = data.length;
  const processedData = direction === 'lt' ? data.map(v => -v) : data;
  
  const positives: number[] = [];
  const negatives: number[] = [];
  for (let i = 0; i < n; i++) {
    if (labels[i] === positiveLabel) positives.push(processedData[i]);
    else negatives.push(processedData[i]);
  }
  
  const np = positives.length;
  const nn = negatives.length;
  
  if (np <= 1 || nn <= 1) return { lowerBound: auc, upperBound: auc };

  // Sort for two-pointer approach
  positives.sort((a, b) => a - b);
  negatives.sort((a, b) => a - b);

  const v10 = new Array(np);
  const v01 = new Array(nn);

  let j = 0;
  for (let i = 0; i < np; i++) {
    while (j < nn && negatives[j] < positives[i]) j++;
    let jTieStart = j;
    while (j < nn && negatives[j] === positives[i]) j++;
    v10[i] = (jTieStart + (j - jTieStart) * 0.5) / nn;
  }

  let i = 0;
  for (let k = 0; k < nn; k++) {
    while (i < np && positives[i] < negatives[k]) i++;
    let iTieStart = i;
    while (i < np && positives[i] === negatives[k]) i++;
    v01[k] = (np - (iTieStart + (i - iTieStart) * 0.5)) / np;
  }
  
  // Variance
  let s10 = 0;
  for (let i = 0; i < np; i++) s10 += Math.pow(v10[i] - auc, 2);
  s10 /= (np - 1);
  
  let s01 = 0;
  for (let k = 0; k < nn; k++) s01 += Math.pow(v01[k] - auc, 2);
  s01 /= (nn - 1);
  
  const variance = s10 / np + s01 / nn;
  const se = Math.sqrt(variance);
  
  const lowerBound = Math.max(0, auc - 1.96 * se);
  const upperBound = Math.min(1, auc + 1.96 * se);
  
  return { lowerBound, upperBound };
}

export function calculateRoc(
  data: number[],
  labels: number[], // 0 or 1
  positiveLabel: number = 1,
  direction: 'gt' | 'lt' = 'gt'
): { points: RocPoint[]; auc: number; optimalCutoff: number; maxYoudenJ: number } {
  const n = data.length;
  if (n === 0 || n !== labels.length) {
    return { points: [], auc: 0, optimalCutoff: 0, maxYoudenJ: 0 };
  }

  // If direction is 'lt', invert the data so we can use the same 'greater than' logic
  const processedData = direction === 'lt' ? data.map(v => -v) : data;

  // Combine and sort by data value descending
  const combined = processedData.map((val, i) => ({ val, label: labels[i] }));
  combined.sort((a, b) => b.val - a.val);

  const totalPositives = combined.filter((d) => d.label === positiveLabel).length;
  const totalNegatives = n - totalPositives;

  if (totalPositives === 0 || totalNegatives === 0) {
    return { points: [], auc: 0, optimalCutoff: 0, maxYoudenJ: 0 };
  }

  const points: RocPoint[] = [];

  // Add initial point (cutoff higher than max value, all predicted negative)
  points.push({
    cutoff: combined[0].val + 1,
    tpr: 0,
    fpr: 0,
    tnr: 1,
    fnr: 1,
    tp: 0,
    fp: 0,
    tn: totalNegatives,
    fn: totalPositives,
    youdenJ: 0,
  });

  let tp = 0;
  let fp = 0;

  // Evaluate each unique value as a potential cutoff threshold (X >= cutoff)
  const uniqueVals = Array.from(new Set(combined.map(d => d.val))).sort((a, b) => b - a);
  let currentIndex = 0;

  for (const cutoff of uniqueVals) {
    // Advance currentIndex to include all items >= cutoff
    while (currentIndex < n && combined[currentIndex].val >= cutoff) {
      if (combined[currentIndex].label === positiveLabel) {
        tp++;
      } else {
        fp++;
      }
      currentIndex++;
    }
    
    const tpr = tp / totalPositives;
    const fpr = fp / totalNegatives;
    const youdenJ = tpr - fpr; // Youden's J = Sensitivity + Specificity - 1 = TPR - FPR

    points.push({
      cutoff,
      tpr,
      fpr,
      tnr: (totalNegatives - fp) / totalNegatives,
      fnr: (totalPositives - tp) / totalPositives,
      tp,
      fp,
      tn: totalNegatives - fp,
      fn: totalPositives - tp,
      youdenJ
    });
  }

  // Calculate AUC using trapezoidal rule
  let auc = 0;
  for (let i = 1; i < points.length; i++) {
    const p1 = points[i - 1];
    const p2 = points[i];
    auc += ((p2.tpr + p1.tpr) / 2) * (p2.fpr - p1.fpr);
  }

  // Find optimal cutoff using Youden's J statistic
  let maxYoudenJ = -Infinity;
  let optimalCutoff = points[0].cutoff;

  for (const point of points) {
    if (point.youdenJ > maxYoudenJ) {
      maxYoudenJ = point.youdenJ;
      optimalCutoff = point.cutoff;
    }
  }

  // Restore original cutoff values if we inverted them
  if (direction === 'lt') {
    points.forEach(p => p.cutoff = -p.cutoff);
    optimalCutoff = -optimalCutoff;
  }

  return { points, auc, optimalCutoff, maxYoudenJ };
}

// Seeded random number generator (Mulberry32)
function mulberry32(a: number) {
  return function() {
    var t = a += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
}

export function calculateAucConfidenceInterval(
  data: number[],
  labels: number[],
  positiveLabel: number = 1,
  direction: 'gt' | 'lt' = 'gt',
  numBootstraps: number = 1000,
  seed: number = 1203
): { lowerBound: number; upperBound: number } {
  const n = data.length;
  const aucs: number[] = [];
  
  const random = mulberry32(seed);

  for (let i = 0; i < numBootstraps; i++) {
    const sampleData: number[] = [];
    const sampleLabels: number[] = [];
    
    let hasPositive = false;
    let hasNegative = false;
    
    for (let j = 0; j < n; j++) {
      const idx = Math.floor(random() * n);
      sampleData.push(data[idx]);
      sampleLabels.push(labels[idx]);
      if (labels[idx] === positiveLabel) hasPositive = true;
      else hasNegative = true;
    }

    if (hasPositive && hasNegative) {
      const result = calculateRoc(sampleData, sampleLabels, positiveLabel, direction);
      aucs.push(result.auc);
    }
  }

  aucs.sort((a, b) => a - b);
  
  if (aucs.length === 0) {
    return { lowerBound: 0, upperBound: 0 };
  }

  const lowerIdx = Math.floor(aucs.length * 0.025);
  const upperIdx = Math.floor(aucs.length * 0.975);

  return {
    lowerBound: aucs[lowerIdx],
    upperBound: aucs[Math.min(upperIdx, aucs.length - 1)]
  };
}

export function calculateMetricsForCutoff(
  data: number[],
  labels: number[],
  cutoff: number,
  direction: 'gt' | 'lt',
  positiveLabel: number = 1
): RocMetrics {
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;

  for (let i = 0; i < data.length; i++) {
    const isPositive = labels[i] === positiveLabel;
    const isPredictedPositive = direction === 'gt' ? data[i] >= cutoff : data[i] <= cutoff;

    if (isPositive && isPredictedPositive) tp++;
    else if (!isPositive && isPredictedPositive) fp++;
    else if (!isPositive && !isPredictedPositive) tn++;
    else if (isPositive && !isPredictedPositive) fn++;
  }

  const totalPositives = tp + fn;
  const totalNegatives = fp + tn;
  const sensitivity = totalPositives > 0 ? tp / totalPositives : 0;
  const specificity = totalNegatives > 0 ? tn / totalNegatives : 0;

  return {
    tp,
    fp,
    tn,
    fn,
    sensitivity,
    specificity,
    accuracy: (tp + tn) / (totalPositives + totalNegatives),
    ppv: (tp + fp) > 0 ? tp / (tp + fp) : 0,
    npv: (tn + fn) > 0 ? tn / (tn + fn) : 0,
    f1: (2 * tp) / (2 * tp + fp + fn) || 0,
    youdenJ: sensitivity + specificity - 1,
  };
}

export function calculateOptimalRoc(
  data: number[],
  labels: number[],
  positiveLabel: number = 1,
  calculateCi: boolean = false,
  forcedDirection?: 'gt' | 'lt'
): { points: RocPoint[]; auc: number; optimalCutoff: number; maxYoudenJ: number; direction: 'gt' | 'lt'; optimalMetrics: RocMetrics; aucCi?: { lowerBound: number; upperBound: number } } {
  let finalResult;
  let direction: 'gt' | 'lt';

  if (forcedDirection) {
    direction = forcedDirection;
    finalResult = calculateRoc(data, labels, positiveLabel, direction);
  } else {
    const resultGt = calculateRoc(data, labels, positiveLabel, 'gt');
    if (resultGt.auc >= 0.5) {
      finalResult = resultGt;
      direction = 'gt';
    } else {
      finalResult = calculateRoc(data, labels, positiveLabel, 'lt');
      direction = 'lt';
    }
  }

  const optimalMetrics = calculateMetricsAtCutoff(data, labels, finalResult.optimalCutoff, positiveLabel, direction);

  let aucCi;
  if (calculateCi) {
    aucCi = calculateDeLongCi(data, labels, finalResult.auc, positiveLabel, direction);
  }

  return { ...finalResult, direction, optimalMetrics, aucCi };
}

export function calculateMetricsAtCutoff(
  data: number[],
  labels: number[],
  cutoff: number,
  positiveLabel: number = 1,
  direction: 'gt' | 'lt' = 'gt'
): RocMetrics {
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;

  for (let i = 0; i < data.length; i++) {
    const val = data[i];
    const label = labels[i];
    const predictedPositive = direction === 'gt' ? val >= cutoff : val <= cutoff;
    const actualPositive = label === positiveLabel;

    if (predictedPositive && actualPositive) tp++;
    else if (predictedPositive && !actualPositive) fp++;
    else if (!predictedPositive && !actualPositive) tn++;
    else if (!predictedPositive && actualPositive) fn++;
  }

  const accuracy = (tp + tn) / (tp + tn + fp + fn) || 0;
  const sensitivity = tp / (tp + fn) || 0;
  const specificity = tn / (tn + fp) || 0;
  const ppv = tp / (tp + fp) || 0;
  const npv = tn / (tn + fn) || 0;
  const f1 = (2 * ppv * sensitivity) / (ppv + sensitivity) || 0;
  const youdenJ = sensitivity + specificity - 1;

  return { accuracy, sensitivity, specificity, ppv, npv, f1, youdenJ, tp, fp, tn, fn };
}
