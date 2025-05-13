// main.js
document.addEventListener('DOMContentLoaded', () => {
    const processVisualizeButton = document.getElementById('processVisualizeButton');
    const navBtns = document.querySelectorAll('.nav-btn');
    const panels = document.querySelectorAll('.panel');

    let fileA_obj = null;
    let fileB_obj = null;
    
    let combinedSparsePoints = null; 
    let N_eff_from_file = 0;
    let globalConfig = {};
    let voroserpWorkerA = null;
    let voroserpWorkerB = null;

    // --- UI Panel Navigation ---
    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            navBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            panels.forEach(p => p.classList.remove('active-panel'));
            document.getElementById(btn.dataset.panel).classList.add('active-panel');
        });
    });

    // --- File Input Handling ---
    document.getElementById('matrixAFile').addEventListener('change', (event) => fileA_obj = event.target.files[0]);
    document.getElementById('matrixBFile').addEventListener('change', (event) => fileB_obj = event.target.files[0]);

    // --- Main Process Button ---
    processVisualizeButton.addEventListener('click', async () => {
        globalConfig = getUIConfig(); 
        combinedSparsePoints = null; 
        N_eff_from_file = 0;      

        setStatus("Starting processing...", "info");
        
        const outputArea = document.getElementById('visualization-output-area');
        outputArea.innerHTML = ''; 

        try {
            // Step 1: Parse input files
            if (!fileA_obj && globalConfig.format !== 'sparse_list_ab') {
                setStatus("Please upload at least Matrix A.", "error"); return;
            }
            if (globalConfig.format === 'sparse_list_ab' && !fileA_obj) {
                setStatus("Please upload the combined sparse list CSV for Matrix A input.", "error"); return;
            }

            if (globalConfig.format === 'dense') {
                let denseA, denseB = null, nA, nB = 0;
                await new Promise((resolve, reject) => {
                    parseDenseCSV(fileA_obj, globalConfig.isTriangular, 
                        (data, n_dim) => { denseA = data; nA = n_dim; resolve(); },
                        (errMsg) => { setStatus(`Error parsing Matrix A: ${errMsg}`, "error"); reject(new Error(errMsg)); }
                    );
                });
                if (!denseA) return; 
                N_eff_from_file = nA;

                if (fileB_obj) {
                    await new Promise((resolve, reject) => {
                        parseDenseCSV(fileB_obj, globalConfig.isTriangular,
                            (data, n_dim) => { denseB = data; nB = n_dim; resolve(); },
                            (errMsg) => { setStatus(`Error parsing Matrix B: ${errMsg}`, "error"); reject(new Error(errMsg)); }
                        );
                    });
                    if (!denseB && globalConfig.displayInputB) { // Only error if B was expected
                         setStatus("Matrix B upload specified but parsing failed.", "error"); return;
                    }
                }
                combinedSparsePoints = convertDenseToSparseABList(denseA, denseB, N_eff_from_file);

            } else if (globalConfig.format === 'sparse_list_ab') {
                await new Promise((resolve, reject) => {
                    parseCSVFile(fileA_obj, 'AB', globalConfig.isTriangular, 
                        (pointsList, detected_N) => { 
                            combinedSparsePoints = pointsList; 
                            N_eff_from_file = detected_N; 
                            resolve(); 
                        }, 
                        (errMsg) => { setStatus(errMsg, "error"); reject(new Error(errMsg)); }
                    );
                });
            } else { // sparse_individual
                let pointsMapA = new Map();
                await new Promise((resolve, reject) => { 
                    parseCSVFile(fileA_obj, 'A', globalConfig.isTriangular, 
                        (pointsList, detected_N_A, pMap) => { 
                            N_eff_from_file = Math.max(N_eff_from_file, detected_N_A); 
                            pointsMapA = pMap; 
                            resolve(); 
                        },
                        (errMsg) => { setStatus(errMsg, "error"); reject(new Error(errMsg)); }
                    );
                });

                if (fileB_obj) {
                    await new Promise((resolve, reject) => { 
                        parseCSVFile(fileB_obj, 'B', globalConfig.isTriangular, 
                            (pointsListFromBprocessing, detected_N_B) => { 
                                combinedSparsePoints = pointsListFromBprocessing; 
                                N_eff_from_file = Math.max(N_eff_from_file, detected_N_B); 
                                resolve(); 
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

            // Use a timeout to allow UI to update
            setTimeout(async () => {
                 try {
                    let initialPointsProcessed = extractInitialPoints( // This adds logRatio, sumVal, id
                        combinedSparsePoints, 
                        globalConfig.valueThreshold, 
                        globalConfig.maxPoints, 
                        globalConfig.logBase, 
                        globalConfig.pseudocount
                    );
                    initialPointsProcessed.forEach((p, idx) => p.id = p.id !== undefined ? p.id : idx);

                    // --- Prepare data for each map type ---
                    let rawPointsA = initialPointsProcessed.map(p => ({...p, value: p.valA}));
                    let rawPointsB = (fileB_obj || globalConfig.format === 'sparse_list_ab') ?
                                      initialPointsProcessed.map(p => ({...p, value: p.valB})) : null;
                    let rawLogRatioPoints = (fileB_obj || globalConfig.format === 'sparse_list_ab') ?
                                      initialPointsProcessed.map(p => ({...p, value: p.logRatio})) : null;
                    
                    let binnedPointsA_data = null; // Will hold {r,c,valA,valB,logRatio,id} from voroserp
                    let binnedPointsB_data = null;
                    let binnedPointsForVisA = null; // Will hold {r,c,value,id} for visualization
                    let binnedPointsForVisB = null;
                    let binnedPointsForVisLogRatio = null;

                    const hasMatrixB = fileB_obj || globalConfig.format === 'sparse_list_ab';

                    if (globalConfig.enableVoroserp) {
                        const voroserpInputBase = initialPointsProcessed.map(p => ({
                            id: p.id, r: p.r, c: p.c,
                            valA: p.valA, valB: p.valB,
                            originalIndex: p.originalIndex !== undefined ? p.originalIndex : p.id
                        }));

                        if (globalConfig.displayBinnedA || (globalConfig.displayBinnedLogRatio && hasMatrixB)) {
                             setStatus("Starting Voroserp for Matrix A data...", "info");
                             document.getElementById('voroserpProgressA').style.display = 'block';
                             updateVoroserpProgress('A',0,0, globalConfig.voroserpMaxIter);
                             let configA = {...globalConfig, voroserpThreshold: globalConfig.voroserpThresholdA, targetValue: 'valA'};
                             // voroserpLoop returns points with valA and valB
                             binnedPointsA_data = globalConfig.runInWorker && typeof(Worker) !== "undefined" ?
                                await runVoroserpInWorker([...voroserpInputBase], N_final, configA, 'A') :
                                voroserpLoop([...voroserpInputBase], N_final, configA, (iter, merged, maxIter) => updateVoroserpProgress('A',iter, merged, maxIter));
                             binnedPointsForVisA = binnedPointsA_data.map(p => ({...p, value: p.valA}));
                             document.getElementById('voroserpProgressA').style.display = 'none';
                        }

                        if (hasMatrixB && (globalConfig.displayBinnedB || globalConfig.displayBinnedLogRatio)) {
                            setStatus("Starting Voroserp for Matrix B data...", "info");
                            document.getElementById('voroserpProgressB').style.display = 'block';
                            updateVoroserpProgress('B',0,0, globalConfig.voroserpMaxIter);
                            let configB = {...globalConfig, voroserpThreshold: globalConfig.voroserpThresholdB, targetValue: 'valB'};
                            binnedPointsB_data = globalConfig.runInWorker && typeof(Worker) !== "undefined" ?
                                await runVoroserpInWorker([...voroserpInputBase], N_final, configB, 'B') :
                                voroserpLoop([...voroserpInputBase], N_final, configB, (iter, merged, maxIter) => updateVoroserpProgress('B',iter, merged, maxIter));
                            binnedPointsForVisB = binnedPointsB_data.map(p => ({...p, value: p.valB}));
                            document.getElementById('voroserpProgressB').style.display = 'none';
                        }
                        
                        if (binnedPointsA_data && binnedPointsB_data) { 
                            binnedPointsForVisLogRatio = calculateLogRatioForBinned(binnedPointsA_data, binnedPointsB_data, globalConfig)
                                                          .map(p => ({...p, value: p.logRatio}));
                        } else if (binnedPointsA_data && !hasMatrixB && globalConfig.displayBinnedA) {
                            // If only A is binned in single matrix mode, Binned A is already prepared.
                            // No binned B or binned log ratio to compute.
                        }
                         setStatus("Voroserp binning complete.", "success");
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
                            
                            // Skip B-related or LogRatio maps if Matrix B wasn't loaded
                            if (!hasMatrixB && (key === 'displayInputB' || key === 'displayNaiveLogRatio' || key === 'displayBinnedB' || key === 'displayBinnedLogRatio')) {
                                continue;
                            }
                            // Skip Binned maps if voroserp wasn't enabled or produced no data for them
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
                            dataCanvas.id = canvasId;
                            dataCanvas.className = 'hic-canvas-dynamic';
                            canvasAndBarDiv.appendChild(dataCanvas);

                            const cbCanvas = document.createElement('canvas');
                            cbCanvas.id = colorbarId;
                            cbCanvas.className = 'colorbar-canvas-dynamic';
                            cbCanvas.width = 60; 
                            cbCanvas.height = globalConfig.canvasSize; // Make colorbar same height as canvas
                            canvasAndBarDiv.appendChild(cbCanvas);
                            
                            groupDiv.appendChild(canvasAndBarDiv);
                            outputArea.appendChild(groupDiv);
                            
                            // Create a fresh copy with infinity points for each visualization
                            // and ensure 'value' field is set correctly for getColor
                            let pointsForThisViz = mapInfo.data.map(p => ({
                                ...p, 
                                // 'value' is already set for rawPointsA/B/LogRatio and binnedPointsForVisA/B/LogRatio
                            }));
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
                        setStatus("No maps selected or no data to display.", "warning");
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
                // If denseMatrixB is null (single matrix mode), valB will be 0.
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
        binnedAData.forEach(p => mapA.set(`${p.r}-${p.c}`, {valA: p.valA, valB_fromA_binning: p.valB})); // Store both from A's perspective

        const mapB = new Map();
        binnedBData.forEach(p => mapB.set(`${p.r}-${p.c}`, {valB: p.valB, valA_fromB_binning: p.valA})); // Store both from B's perspective

        const allCoords = new Set([...mapA.keys(), ...mapB.keys()]);
        let logRatioPoints = [];
        let idCounter = 0;

        allCoords.forEach(key => {
            const [r_str, c_str] = key.split('-');
            const r = parseInt(r_str);
            const c = parseInt(c_str);
            
            // Use the valA from A's binning and valB from B's binning if available
            // Fallback if one was not binned (e.g., if a point was entirely removed in one binning)
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
    
    navBtns[0].click(); 
    globalConfig = getUIConfig(); 
    // Initial dummy colorbar draw, will be updated by actual visualizations
    const colorbarCanvas = document.getElementById('colorbarCanvas'); // Main colorbar, now unused.
    if (colorbarCanvas) colorbarCanvas.height = globalConfig.canvasSize; // Match initial canvas size
    // drawColorbar('colorbarCanvas', globalConfig.colormapLogRatio, globalConfig.colorMinLogRatio, globalConfig.colorMaxLogRatio); 
});

function getUIConfig() { 
    return {
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