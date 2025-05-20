// main.js
document.addEventListener('DOMContentLoaded', () => {
    const processVisualizeButton = document.getElementById('processVisualizeButton');
    const navBtns = document.querySelectorAll('.nav-btn');
    const panels = document.querySelectorAll('.panel');
    const dataSourceASelect = document.getElementById('dataSourceA');
    const dataSourceBSelect = document.getElementById('dataSourceB');
    const matrixADemoSelect = document.getElementById('matrixADemo');
    const matrixBDemoSelect = document.getElementById('matrixBDemo');

    let combinedSparsePoints = null; 
    let N_eff_from_file = 0;
    let globalConfig = {};
    let voroserpWorkerA = null;
    let voroserpWorkerB = null;

    // --- Predefined Demo Files ---
    const demoFiles = {
        "Demo A (Small Dense)": "./demos/A.csv",
        "Demo B (Small Dense)": "./demos/B.csv",
    };

    function populateDemoSelects() {
        matrixADemoSelect.innerHTML = ''; // Clear existing options
        matrixBDemoSelect.innerHTML = '';

        for (const [name, path] of Object.entries(demoFiles)) {
            const optionA = document.createElement('option');
            optionA.value = path;
            optionA.textContent = name;
            matrixADemoSelect.appendChild(optionA);

            const optionB = document.createElement('option');
            optionB.value = path;
            optionB.textContent = name;
            matrixBDemoSelect.appendChild(optionB);
        }
    }
    populateDemoSelects();

    // --- UI Panel Navigation & Data Source Toggling ---
    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            navBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            panels.forEach(p => p.classList.remove('active-panel'));
            const targetPanelId = btn.dataset.panel;
            const targetPanel = document.getElementById(targetPanelId);
            if (targetPanel) {
                targetPanel.classList.add('active-panel');
            } else {
                console.error("Target panel not found:", targetPanelId);
            }
        });
    });

    function toggleDataSourceInputs(selectElement, typePrefix) {
        const selectedSource = selectElement.value;
        const fileUploadGroup = document.getElementById(`${typePrefix}FileUploadGroup`);
        const urlGroup = document.getElementById(`${typePrefix}UrlGroup`);
        const demoGroup = document.getElementById(`${typePrefix}DemoGroup`);
        const gzippedCheckboxParent = document.getElementById(`${typePrefix}IsGzipped`)?.parentElement;

        if(fileUploadGroup) fileUploadGroup.style.display = selectedSource === 'file' ? 'block' : 'none';
        if(urlGroup) urlGroup.style.display = selectedSource === 'url' ? 'block' : 'none';
        if(demoGroup) demoGroup.style.display = selectedSource === 'demo' ? 'block' : 'none';
        
        const gzippedCheckbox = document.getElementById(`${typePrefix}IsGzipped`);
        if (gzippedCheckbox) {
             gzippedCheckbox.disabled = selectedSource === 'file'; // Enable for URL/Demo, disable for file (auto-detect)
             if (selectedSource === 'file') gzippedCheckbox.checked = false; // Reset for file
        }

        if (typePrefix === 'matrixB') {
            const showBGroups = selectedSource !== 'none';
            if(fileUploadGroup) fileUploadGroup.style.display = showBGroups && selectedSource === 'file' ? 'block' : 'none';
            if(urlGroup) urlGroup.style.display = showBGroups && selectedSource === 'url' ? 'block' : 'none';
            if(demoGroup) demoGroup.style.display = showBGroups && selectedSource === 'demo' ? 'block' : 'none';
            if(gzippedCheckboxParent) gzippedCheckboxParent.style.display = showBGroups ? 'flex' : 'none';
        } else { // For Matrix A, gzipped checkbox group is always potentially visible
            if(gzippedCheckboxParent) gzippedCheckboxParent.style.display = 'flex';
        }
    }

    dataSourceASelect.addEventListener('change', () => toggleDataSourceInputs(dataSourceASelect, 'matrixA'));
    dataSourceBSelect.addEventListener('change', () => toggleDataSourceInputs(dataSourceBSelect, 'matrixB'));
    
    // Initialize input visibility
    toggleDataSourceInputs(dataSourceASelect, 'matrixA');
    toggleDataSourceInputs(dataSourceBSelect, 'matrixB');


    // --- Main Process Button ---
    processVisualizeButton.addEventListener('click', async () => {
        globalConfig = getUIConfig(); 
        combinedSparsePoints = null; 
        N_eff_from_file = 0;      

        setStatus("Starting processing...", "info");
        const outputArea = document.getElementById('visualization-output-area');
        if(outputArea) outputArea.innerHTML = ''; 

        try {
            let inputSourceA, sourceMetaA, inputSourceB = null, sourceMetaB = null;

            // --- Determine Input Sources for A ---
            sourceMetaA = { type: globalConfig.dataSourceA, name: 'Matrix A', isGzipped: globalConfig.matrixAIsGzipped, fileType: 'A' };
            if (globalConfig.dataSourceA === 'file') inputSourceA = document.getElementById('matrixAFile').files[0];
            else if (globalConfig.dataSourceA === 'url') inputSourceA = document.getElementById('matrixAUrl').value.trim();
            else if (globalConfig.dataSourceA === 'demo') inputSourceA = document.getElementById('matrixADemo').value;
            
            if (inputSourceA && typeof inputSourceA === 'string' && inputSourceA.endsWith('.gz')) sourceMetaA.isGzipped = true;
            if (inputSourceA instanceof File && inputSourceA.name.endsWith('.gz')) sourceMetaA.isGzipped = true;


            // --- Determine Input Sources for B (if not 'none') ---
            const hasMatrixBInput = globalConfig.dataSourceB !== 'none';
            if (hasMatrixBInput) {
                sourceMetaB = { type: globalConfig.dataSourceB, name: 'Matrix B', isGzipped: globalConfig.matrixBIsGzipped, fileType: 'B' };
                if (globalConfig.dataSourceB === 'file') inputSourceB = document.getElementById('matrixBFile').files[0];
                else if (globalConfig.dataSourceB === 'url') inputSourceB = document.getElementById('matrixBUrl').value.trim();
                else if (globalConfig.dataSourceB === 'demo') inputSourceB = document.getElementById('matrixBDemo').value;

                if (inputSourceB && typeof inputSourceB === 'string' && inputSourceB.endsWith('.gz')) sourceMetaB.isGzipped = true;
                if (inputSourceB instanceof File && inputSourceB.name.endsWith('.gz')) sourceMetaB.isGzipped = true;
            }

            // Step 1: Parse input
            if (!inputSourceA && globalConfig.format !== 'sparse_list_ab') { // Matrix A is always required unless combined format
                setStatus("Please provide input for Matrix A.", "error"); return;
            }
            if (globalConfig.format === 'sparse_list_ab' && !inputSourceA) { // For combined, Matrix A input field is used
                setStatus("Please provide the combined sparse list for Matrix A input.", "error"); return;
            }

            if (globalConfig.format === 'dense') {
                let denseA, denseB = null, nA, nB = 0;
                await new Promise((resolve, reject) => {
                    parseInput(inputSourceA, sourceMetaA, 'dense', globalConfig.isTriangular,
                        (data, n_dim) => { denseA = data; nA = n_dim; resolve(); },
                        (errMsg) => { setStatus(`Error parsing Matrix A: ${errMsg}`, "error"); reject(new Error(errMsg)); }
                    );
                });
                if (!denseA) return;
                N_eff_from_file = nA;

                if (hasMatrixBInput && inputSourceB) {
                    await new Promise((resolve, reject) => {
                        parseInput(inputSourceB, sourceMetaB, 'dense', globalConfig.isTriangular,
                            (data, n_dim) => { denseB = data; nB = n_dim; resolve(); },
                            (errMsg) => { setStatus(`Error parsing Matrix B: ${errMsg}`, "error"); reject(new Error(errMsg)); }
                        );
                    });
                    if (!denseB && globalConfig.displayInputB) { setStatus("Matrix B selected but parsing failed.", "error"); return; }
                     if (denseB && (nA !== nB || denseA.length !== denseB.length || (denseA[0] && denseB[0] && denseA[0].length !== denseB[0].length))) {
                        setStatus("Dense matrices A and B must have same dimensions.", "error"); return;
                    }
                }
                combinedSparsePoints = convertDenseToSparseABList(denseA, denseB, N_eff_from_file);
            } else if (globalConfig.format === 'sparse_list_ab') {
                sourceMetaA.fileType = 'AB'; 
                await new Promise((resolve, reject) => {
                    parseInput(inputSourceA, sourceMetaA, 'sparse_list_ab', globalConfig.isTriangular, 
                        (pointsList, detected_N) => { 
                            combinedSparsePoints = pointsList; N_eff_from_file = detected_N; resolve(); 
                        }, 
                        (errMsg) => { setStatus(errMsg, "error"); reject(new Error(errMsg)); }
                    );
                });
            } else { // sparse_individual
                let pointsMapA = new Map();
                await new Promise((resolve, reject) => { 
                    parseInput(inputSourceA, sourceMetaA, 'sparse_individual', globalConfig.isTriangular, 
                        (pointsList, detected_N_A, pMap) => { 
                            N_eff_from_file = Math.max(N_eff_from_file, detected_N_A); pointsMapA = pMap; resolve(); 
                        },
                        (errMsg) => { setStatus(errMsg, "error"); reject(new Error(errMsg)); }
                    );
                });

                if (hasMatrixBInput && inputSourceB) {
                    await new Promise((resolve, reject) => { 
                        parseInput(inputSourceB, sourceMetaB, 'sparse_individual', globalConfig.isTriangular, 
                            (pointsListFromB, detected_N_B) => { // This callback now receives the merged pointsMap as pointsListFromB
                                combinedSparsePoints = pointsListFromB; N_eff_from_file = Math.max(N_eff_from_file, detected_N_B); resolve(); 
                            },
                            (errMsg) => { setStatus(errMsg, "error"); reject(new Error(errMsg)); }, 
                            pointsMapA 
                        );
                    });
                } else { 
                    combinedSparsePoints = Array.from(pointsMapA.values());
                }
            }

            if (!combinedSparsePoints || combinedSparsePoints.length === 0) {
                setStatus("No data points to process after parsing.", "error"); return;
            }
            
            const N_final = N_eff_from_file > 0 ? N_eff_from_file : globalConfig.matrixDim;
            globalConfig.matrixDim = N_final;

            setStatus(`Data parsed. Dim: ${N_final}x${N_final}. ${combinedSparsePoints.length} unique points. Processing...`, "info");

            setTimeout(async () => {
                 try {
                    let initialPointsProcessed = extractInitialPoints( 
                        combinedSparsePoints, 
                        globalConfig.valueThreshold, 
                        globalConfig.maxPoints, 
                        globalConfig.logBase, 
                        globalConfig.pseudocount
                    );
                    
                    initialPointsProcessed.forEach((p, idx) => p.id = p.id !== undefined ? p.id : idx);

                    let rawPointsA = initialPointsProcessed.map(p => ({...p, value: p.valA}));
                    let rawPointsB = hasMatrixBInput ? initialPointsProcessed.map(p => ({...p, value: p.valB})) : null;
                    let rawLogRatioPoints = hasMatrixBInput ? initialPointsProcessed.map(p => ({...p, value: p.logRatio})) : null;
                    
                    let binnedPointsA_data = null; 
                    let binnedPointsB_data = null;
                    let binnedPointsForVisA = null; 
                    let binnedPointsForVisB = null;
                    let binnedPointsForVisLogRatio = null;

                    if (globalConfig.enableVoroserp) {
                        const voroserpInputBase = initialPointsProcessed.map(p => ({
                            id: p.id, r: p.r, c: p.c,
                            valA: p.valA, valB: p.valB,
                            originalIndex: p.originalIndex !== undefined ? p.originalIndex : p.id
                        }));

                        const progressAEl = document.getElementById('voroserpProgressA');
                        const progressBEl = document.getElementById('voroserpProgressB');

                        if (globalConfig.displayBinnedA || (globalConfig.displayBinnedLogRatio && hasMatrixBInput)) {
                             setStatus("Starting Voroserp for Matrix A data...", "info");
                             if (progressAEl) progressAEl.style.display = 'block';
                             updateVoroserpProgress('A',0,0, globalConfig.voroserpMaxIter);
                             let configA = {...globalConfig, voroserpThreshold: globalConfig.voroserpThresholdA, targetValue: 'valA'};
                             binnedPointsA_data = globalConfig.runInWorker && typeof(Worker) !== "undefined" ?
                                await runVoroserpInWorker([...voroserpInputBase], N_final, configA, 'A') :
                                voroserpLoop([...voroserpInputBase], N_final, configA, (iter, merged,maxIter) => updateVoroserpProgress('A',iter, merged, maxIter));
                             if (binnedPointsA_data) binnedPointsForVisA = binnedPointsA_data.map(p => ({...p, value: p.valA}));
                             if (progressAEl) progressAEl.style.display = 'none';
                        }

                        if (hasMatrixBInput && (globalConfig.displayBinnedB || globalConfig.displayBinnedLogRatio)) {
                            setStatus("Starting Voroserp for Matrix B data...", "info");
                            if (progressBEl) progressBEl.style.display = 'block';
                            updateVoroserpProgress('B',0,0, globalConfig.voroserpMaxIter);
                            let configB = {...globalConfig, voroserpThreshold: globalConfig.voroserpThresholdB, targetValue: 'valB'};
                            binnedPointsB_data = globalConfig.runInWorker && typeof(Worker) !== "undefined" ?
                                await runVoroserpInWorker([...voroserpInputBase], N_final, configB, 'B') :
                                voroserpLoop([...voroserpInputBase], N_final, configB, (iter, merged,maxIter) => updateVoroserpProgress('B',iter, merged, maxIter));
                            if (binnedPointsB_data) binnedPointsForVisB = binnedPointsB_data.map(p => ({...p, value: p.valB}));
                            if (progressBEl) progressBEl.style.display = 'none';
                        }
                        
                        if (binnedPointsA_data && binnedPointsB_data) { 
                            binnedPointsForVisLogRatio = calculateLogRatioForBinned(binnedPointsA_data, binnedPointsB_data, globalConfig)
                                                          .map(p => ({...p, value: p.logRatio}));
                        }
                         setStatus("Voroserp binning complete (if enabled).", "success");
                    }
                    
                    const mapsToDisplayConfig = {
                        displayInputA: { data: rawPointsA, type: 'A', title: 'Input A (Raw Voronoi)' },
                        displayInputB: { data: rawPointsB, type: 'B', title: 'Input B (Raw Voronoi)' },
                        displayNaiveLogRatio: { data: rawLogRatioPoints, type: 'LogRatio', title: 'Naive Log Ratio (Raw Voronoi)' },
                        displayBinnedA: { data: binnedPointsForVisA, type: 'A', title: 'Voroserp Binned A' },
                        displayBinnedB: { data: binnedPointsForVisB, type: 'B', title: 'Voroserp Binned B' },
                        displayBinnedLogRatio: { data: binnedPointsForVisLogRatio, type: 'LogRatio', title: 'Voroserp Binned Log Ratio' }
                    };

                    const vizPromises = [];
                    for (const key in mapsToDisplayConfig) {
                        if (globalConfig[key] && mapsToDisplayConfig[key].data && mapsToDisplayConfig[key].data.length > 0) {
                            const mapInfo = mapsToDisplayConfig[key];
                            
                            if (!hasMatrixBInput && (key === 'displayInputB' || key === 'displayNaiveLogRatio' || key === 'displayBinnedB' || key === 'displayBinnedLogRatio')) {
                                continue;
                            }
                            if (key.startsWith('displayBinned') && !globalConfig.enableVoroserp) {
                                continue;
                            }

                            const canvasId = `hicCanvas-${key}`;
                            const colorbarId = `colorbarCanvas-${key}`;
                            
                            const groupDiv = document.createElement('div');
                            groupDiv.className = 'canvas-group';
                            const titleH3 = document.createElement('h3');
                            titleH3.textContent = mapInfo.title;
                            groupDiv.appendChild(titleH3);
                            const canvasAndBarDiv = document.createElement('div');
                            canvasAndBarDiv.className = 'canvas-and-colorbar';
                            const dataCanvas = document.createElement('canvas');
                            dataCanvas.id = canvasId; dataCanvas.className = 'hic-canvas-dynamic';
                            canvasAndBarDiv.appendChild(dataCanvas);
                            const cbCanvas = document.createElement('canvas');
                            cbCanvas.id = colorbarId; cbCanvas.className = 'colorbar-canvas-dynamic';
                            cbCanvas.width = 60; cbCanvas.height = globalConfig.canvasSize;
                            canvasAndBarDiv.appendChild(cbCanvas);
                            groupDiv.appendChild(canvasAndBarDiv);
                            if (outputArea) outputArea.appendChild(groupDiv);
                            
                            let pointsForThisViz = mapInfo.data.map(p => ({ ...p })); 
                            let vizDataWithInfinity = addInfinityPoints(pointsForThisViz, [N_final, N_final]);
                            
                            vizPromises.push(new Promise(resolve => setTimeout(() => {
                                drawVisualization(canvasId, colorbarId, vizDataWithInfinity, N_final, globalConfig, mapInfo.type, mapInfo.title);
                                resolve();
                            }, 0)));
                        }
                    }
                    await Promise.all(vizPromises);
                     if (vizPromises.length > 0) {
                        setStatus("All selected visualizations complete.", "success");
                    } else {
                         setStatus("No maps selected or no data to display for selection.", "warning");
                    }

                } catch (e) {
                    setStatus("Error during processing/visualization: " + e.message + "\nStack: " + e.stack, "error");
                    console.error(e);
                }
            }, 50);

        } catch (err) {
            setStatus(`File processing chain failed: ${err.message}`, "error");
            console.error(err);
        }
    });
    
    function convertDenseToSparseABList(denseMatrixA, denseMatrixB, N) {
        const sparseList = [];
        let idCounter = 0;
        for(let r=0; r < N; r++) {
            for (let c=0; c < N ; c++) {
                const valA = (denseMatrixA && denseMatrixA[r] && denseMatrixA[r][c] !== undefined) ? denseMatrixA[r][c] : 0;
                const valB_temp = (denseMatrixB && denseMatrixB[r] && denseMatrixB[r][c] !== undefined) ? denseMatrixB[r][c] : 0;
                const valB = denseMatrixB ? valB_temp : 0;

                if (valA > 0 || valB > 0) { 
                    sparseList.push({r, c, valA, valB, id: idCounter++});
                }
            }
        }
        return sparseList;
    }

    function calculateLogRatioForBinned(binnedAData, binnedBData, config) {
        const mapA = new Map();
        if (binnedAData) binnedAData.forEach(p => mapA.set(`${p.r}-${p.c}`, {valA: p.valA, valB_fromA_binning: p.valB}));

        const mapB = new Map();
        if (binnedBData) binnedBData.forEach(p => mapB.set(`${p.r}-${p.c}`, {valB: p.valB, valA_fromB_binning: p.valA})); 

        const allCoords = new Set([...mapA.keys(), ...mapB.keys()]);
        let logRatioPoints = [];
        let idCounter = 0;

        allCoords.forEach(key => {
            const [r_str, c_str] = key.split('-');
            const r = parseInt(r_str);
            const c = parseInt(c_str);
            
            const dataA = mapA.get(key);
            const dataB = mapB.get(key);

            const valA = dataA ? dataA.valA : (dataB ? dataB.valA_fromB_binning : 0);
            const valB = dataB ? dataB.valB : (dataA ? dataA.valB_fromA_binning : 0);

            let logRatioVal = 0;
            const valA_eff = (valA || 0) + config.pseudocount;
            const valB_eff = (valB || 0) + config.pseudocount;

            if (valA_eff > 0 && valB_eff > 0) {
                logRatioVal = log(valA_eff / valB_eff, config.logBase);
            } else if (valA_eff > 0) {
                logRatioVal = Infinity;
            } else if (valB_eff > 0) {
                logRatioVal = -Infinity;
            }
            logRatioPoints.push({r, c, valA, valB, logRatio: logRatioVal, id: idCounter++});
        });
        
        const finiteLogRatios = logRatioPoints.map(p => p.logRatio).filter(lr => isFinite(lr));
        if (finiteLogRatios.length > 0) {
            const meanLogRatio = mean(finiteLogRatios);
            const sortedFinite = [...finiteLogRatios].sort((a,b) => a-b);
            const capPositive = sortedFinite.length > 0 ? (sortedFinite[Math.floor(sortedFinite.length * 0.99)] - meanLogRatio) +1 : 10;
            const capNegative = sortedFinite.length > 0 ? (sortedFinite[Math.ceil(sortedFinite.length * 0.01)] - meanLogRatio) -1 : -10;

            logRatioPoints.forEach(p => {
                if (isFinite(p.logRatio)) {
                    p.logRatio -= meanLogRatio;
                } else if (p.logRatio === Infinity) {
                    p.logRatio = capPositive;
                } else if (p.logRatio === -Infinity) {
                    p.logRatio = capNegative;
                }
            });
        }
        return logRatioPoints;
    }

    function runVoroserpInWorker(points, nEff, config, workerType) { 
        return new Promise((resolve, reject) => {
            let worker = workerType === 'A' ? voroserpWorkerA : voroserpWorkerB;
            if (worker) {
                worker.terminate(); 
            }
            worker = new Worker('voroserp.worker.js');
            if (workerType === 'A') voroserpWorkerA = worker; else voroserpWorkerB = worker;
            
            worker.onmessage = (e) => {
                if (e.data.type === 'progress') {
                    updateVoroserpProgress(workerType, e.data.iteration, e.data.mergedThisIteration, config.voroserpMaxIter);
                } else if (e.data.type === 'result') {
                    resolve(e.data.points);
                    if(worker) worker.terminate();
                    if (workerType === 'A') voroserpWorkerA = null; else voroserpWorkerB = null;
                } else if (e.data.type === 'error') {
                    console.error(`Error from worker ${workerType}:`, e.data);
                    reject(new Error(e.data.message + (e.data.stack ? `\nStack: ${e.data.stack}` : '')));
                    if(worker) worker.terminate();
                    if (workerType === 'A') voroserpWorkerA = null; else voroserpWorkerB = null;
                }
            };
            worker.onerror = (e) => {
                console.error(`Actual worker ${workerType} onerror:`, e);
                reject(new Error(`Worker ${workerType} error: ${e.message} at ${e.filename}:${e.lineno}`));
                if(worker) worker.terminate();
                if (workerType === 'A') voroserpWorkerA = null; else voroserpWorkerB = null;
            };
            worker.postMessage({ pointsDataArray: points, N_eff: nEff, config: config });
        });
    }

    function updateVoroserpProgress(workerType, iteration, mergedCountAccumulator, maxIter) {
        const progressBarFill = document.getElementById(`voroserpProgressBarFill${workerType}`);
        const iterCountSpan = document.getElementById(`voroserpIterCount${workerType}`);
        const mergedCountSpan = document.getElementById(`voroserpMergedCount${workerType}`);
        
        if (progressBarFill && iterCountSpan && mergedCountSpan) {
            const progress = maxIter > 0 ? Math.min(100, (iteration / maxIter) * 100) : 0;
            progressBarFill.style.width = `${progress}%`;
            iterCountSpan.textContent = `${iteration}`;
            mergedCountSpan.textContent = `${mergedCountAccumulator}`;
        }
    }
    
    // --- Initial UI Setup ---
    if (navBtns.length > 0) {
        navBtns[0].click(); 
    }
    globalConfig = getUIConfig(); 
    // No initial main canvas draw, output area is populated on demand.
});

function getUIConfig() { 
    return {
        dataSourceA: document.getElementById('dataSourceA').value,
        matrixAIsGzipped: document.getElementById('matrixAIsGzipped').checked,
        dataSourceB: document.getElementById('dataSourceB').value,
        matrixBIsGzipped: document.getElementById('matrixBIsGzipped').checked,

        format: document.getElementById('format').value,
        matrixDim: parseInt(document.getElementById('matrixDim').value),
        isTriangular: document.getElementById('isTriangular').checked,
        logBase: document.getElementById('logBase').value,
        pseudocount: parseFloat(document.getElementById('pseudocount').value),
        valueThreshold: parseFloat(document.getElementById('valueThreshold').value),
        maxPoints: parseInt(document.getElementById('maxPoints').value),
        
        displayInputA: document.getElementById('displayInputA').checked,
        displayInputB: document.getElementById('displayInputB').checked,
        displayNaiveLogRatio: document.getElementById('displayNaiveLogRatio').checked,
        displayBinnedA: document.getElementById('displayBinnedA').checked,
        displayBinnedB: document.getElementById('displayBinnedB').checked,
        displayBinnedLogRatio: document.getElementById('displayBinnedLogRatio').checked,

        colormapLogRatio: document.getElementById('colormapLogRatio').value,
        colormapSingle: document.getElementById('colormapSingle').value,
        colorMinLogRatio: parseFloat(document.getElementById('colorMinLogRatio').value),
        colorMaxLogRatio: parseFloat(document.getElementById('colorMaxLogRatio').value),
        autoScaleSingleMatrix: document.getElementById('autoScaleSingleMatrix').checked,
        colorMinSingle: parseFloat(document.getElementById('colorMinSingle').value),
        colorMaxSingle: parseFloat(document.getElementById('colorMaxSingle').value),

        showDelaunay: document.getElementById('showDelaunay').checked,
        showVoronoiEdges: document.getElementById('showVoronoiEdges').checked,
        showPoints: document.getElementById('showPoints').checked,
        pointSize: parseFloat(document.getElementById('pointSize').value),
        canvasSize: parseInt(document.getElementById('canvasSize').value),
        
        enableVoroserp: document.getElementById('enableVoroserp').checked,
        voroserpThresholdA: parseInt(document.getElementById('voroserpThresholdA').value),
        voroserpThresholdB: parseInt(document.getElementById('voroserpThresholdB').value),
        voroserpMaxIter: parseInt(document.getElementById('voroserpMaxIter').value),
        runInWorker: document.getElementById('runInWorker').checked
    };
}

// setStatus is defined in utils.js