// dataProcessor.js
function extractInitialPoints(sparsePointsList, valueThreshold, maxPoints, logBase, pseudocount) {
    let pointsData = sparsePointsList.map((p, index) => {
        let logRatioVal = 0;
        const valA_eff = (p.valA || 0) + pseudocount; // Ensure valA/valB exist
        const valB_eff = (p.valB || 0) + pseudocount;

        if (valA_eff > 0 && valB_eff > 0) {
            logRatioVal = log(valA_eff / valB_eff, logBase);
        } else if (valA_eff > 0) {
            logRatioVal = Infinity; 
        } else if (valB_eff > 0) {
            logRatioVal = -Infinity;
        }
        return { 
            r: p.r, c: p.c, 
            valA: p.valA || 0, valB: p.valB || 0, 
            logRatio: logRatioVal, 
            sumVal: (p.valA || 0) + (p.valB || 0), 
            id: index, // Simple ID for now, can be made more robust
            originalIndex: index // Keep track of original index before filtering/sorting
        };
    }).filter(p => p.sumVal >= valueThreshold);
    
    if (pointsData.length > maxPoints) {
        pointsData.sort((a, b) => b.sumVal - a.sumVal);
        pointsData = pointsData.slice(0, maxPoints);
    }
    
    const finiteLogRatios = pointsData.map(p => p.logRatio).filter(lr => isFinite(lr));
    if (finiteLogRatios.length > 0) {
        const meanLogRatio = mean(finiteLogRatios);
        const maxFinite = Math.max(...finiteLogRatios, 0);
        const minFinite = Math.min(...finiteLogRatios, 0);
        pointsData.forEach(p => {
            if (isFinite(p.logRatio)) {
                p.logRatio -= meanLogRatio;
            } else if (p.logRatio === Infinity) {
                p.logRatio = (maxFinite - meanLogRatio) + 1 || 10;
            } else if (p.logRatio === -Infinity) {
                p.logRatio = (minFinite - meanLogRatio) - 1 || -10;
            }
        });
    } else {
        pointsData.forEach(p => {
            if (p.logRatio === Infinity) p.logRatio = 10;
            else if (p.logRatio === -Infinity) p.logRatio = -10;
            else p.logRatio = 0;
        });
    }
    return pointsData; // Array of {r,c,valA,valB,logRatio,sumVal,id,originalIndex}
}

function buildNeighborGraph(pointsData) { // Takes array of point objects
    const pointsForDelaunay = pointsData.map(p => [p.c, p.r]); // Use c (x) then r (y)
    if (pointsForDelaunay.length < 3) return null;

    // d3.Delaunay.from is the correct API call
    const delaunay = d3.Delaunay.from(pointsForDelaunay);
    const neighbors = []; // This will store sets of original point IDs
    
    for (let i = 0; i < pointsData.length; i++) {
        const pointId = pointsData[i].id; // Get the ID of the current point
        neighbors[pointId] = new Set(); // Use pointId as index if they are dense 0...N-1
                                       // Or use a Map if IDs are not sequential/dense
        for (const neighborIndex of delaunay.neighbors(i)) {
            neighbors[pointId].add(pointsData[neighborIndex].id); // Store ID of neighbor
        }
    }
    return { delaunay, neighbors }; // neighbors is now an array of Sets, indexed by original point ID
}