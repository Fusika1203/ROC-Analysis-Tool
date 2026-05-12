# 📊 ROC Analysis Tool

A professional web application for **ROC (Receiver Operating Characteristic) Analysis**, built with **React**, **TypeScript**, and **Render**. This tool helps evaluate diagnostic models and clinical variables by determining the optimal cutoff point and gives you performance metrics.
Link to website: https://roc-analysis-tool.onrender.com

## ✨ Key Features
* **ROC Curve Visualization:** Dynamic plotting of Sensitivity vs. 1-Specificity.
* **Optimal Cutoff Discovery:** Automated calculation of the best threshold using **Youden’s Index**.
* **Real-time Metrics:** Instant calculation of Accuracy, Sensitivity (TPR), and Specificity (TNR),...
* **Responsive UI:** A modern, clean interface powered by **Tailwind CSS**.

## 🧪 Methodology
The tool identifies the optimal threshold by maximizing the **Youden’s Index** ($J$):
$$J = \text{Sensitivity} + \text{Specificity} - 1$$

## 🚀 Getting Started

### Local Development
1. **Download and install Node.js:** https://nodejs.org/en/download
2. **Clone the repository:**
   ```bash
   git clone https://github.com/Fusika1203/ROC-Analysis_Tool.git
   cd roc-analysis-tool
3. **Install dependencies:**
   ```bash
   npm install
4. **Run the app:**
   ```bash
   npm run dev
   
## 🌐 Deployment

This project is optimized for deploying in **Vercel** or **Render**:

* **Build Command:** `npm run build`
* **Publish Directory:** `dist`
---
*Developed by FUSIKA*
