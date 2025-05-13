// voroserp.worker.js
self.importScripts('https://d3js.org/d3.v7.min.js', 'utils.js', 'dataProcessor.js', 'voroserp.js');
// Note: utils.js and dataProcessor.js need to be careful about DOM access if any.
// voroserp.js now contains the main loop.

self.onmessage = function(e) {
    try {
        const { pointsDataArray, N_eff, config } = e.data;
        
        // The voroserpLoop function is now defined globally in the worker 
        // by importing voroserp.js
        const resultPoints = voroserpLoop(pointsDataArray, N_eff, config, 
            (iteration, mergedThisIteration, maxIter) => {
                self.postMessage({ 
                    type: 'progress', 
                    iteration, 
                    mergedThisIteration,
                    maxIter
                });
            }
        );
        self.postMessage({ type: 'result', points: resultPoints });
    } catch (error) {
        self.postMessage({ type: 'error', message: error.message, stack: error.stack });
        console.error("Worker error:", error);
    }
};