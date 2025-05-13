// voroserp.js - Main thread version for now, worker adaptation later

function voroserpLoop(pointsDataArray, N_eff, config, progressCallback) {
    let points = JSON.parse(JSON.stringify(pointsDataArray.filter(p => !p.isInfinity))); // Work on non-infinity points
    
    // Assign stable IDs if not already present or use originalIndex
    points.forEach((p, idx) => { 
        if (p.id === undefined) p.id = p.originalIndex !== undefined ? p.originalIndex : idx;
        p.removed = false; // Initialize removed flag
    });

    let currentIteration = 0;
    let totalMergedInLoop;

    do {
        totalMergedInLoop = 0;
        
        // Build Delaunay graph and neighbor sets for *current active* points
        let activePoints = points.filter(p => !p.removed);
        if (activePoints.length < 3) break; // Not enough to form triangles

        const activePointsCoords = activePoints.map(p => [p.c, p.r]);
        const delaunayResult = buildNeighborGraph(activePoints); // Pass full objects to map IDs
        
        if (!delaunayResult) break; // Delaunay failed
        
        // `delaunayResult.neighbors` is an array of Sets, where index corresponds to `activePoints`
        // We need a map from point.id to its neighbors' ids
        const neighborMap = new Map();
        activePoints.forEach((p, idx) => {
            const neighborOriginalIds = new Set();
            if (delaunayResult.neighbors[p.id]) { // Check if p.id is a valid index for neighbors array
                 for (const neighborActiveIndex of delaunayResult.neighbors[p.id]) { // This assumes neighbors is indexed by p.id
                    // This mapping is tricky if buildNeighborGraph indexes differently.
                    // Let's assume buildNeighborGraph returns neighbors indexed by original point.id
                    neighborOriginalIds.add(neighborActiveIndex); // Assuming neighborActiveIndex is already an ID
                 }
            }
            neighborMap.set(p.id, neighborOriginalIds);
        });


        // Shuffle points to process for merging (those not yet removed)
        let pointsToProcess = [...activePoints].sort(() => Math.random() - 0.5);

        for (const p of pointsToProcess) {
            if (p.removed) continue;

            if ((p.valA < config.voroserpThreshold) || (p.valB < config.voroserpThreshold)) {
                const pNeighborsIds = neighborMap.get(p.id);
                if (!pNeighborsIds || pNeighborsIds.size === 0) continue;

                let currentNeighbors = [];
                for (const neighborId of pNeighborsIds) {
                    const neighborPt = points.find(pt => pt.id === neighborId && !pt.removed);
                    if (neighborPt) currentNeighbors.push(neighborPt);
                }
                
                if (currentNeighbors.length === 0) continue;

                const distances = currentNeighbors.map(n => {
                    const dr = n.r - p.r;
                    const dc = n.c - p.c;
                    return dr * dr + dc * dc;
                });
                const invDistances = distances.map(d => 1 / (d + Number.EPSILON));
                const sumInvDistances = invDistances.reduce((s, d) => s + d, 0);

                if (sumInvDistances === 0) continue;
                
                const probabilities = invDistances.map(d_inv => d_inv / sumInvDistances);
                let cumProb = 0;
                const cumProbabilities = probabilities.map(prob => cumProb += prob);

                const rand = Math.random() * (cumProbabilities.length > 0 ? cumProbabilities[cumProbabilities.length - 1] : 0);
                let fuseNeighbor = null;
                for (let k = 0; k < cumProbabilities.length; k++) {
                    if (rand < cumProbabilities[k]) {
                        fuseNeighbor = currentNeighbors[k];
                        break;
                    }
                }
                if (!fuseNeighbor && currentNeighbors.length > 0) fuseNeighbor = currentNeighbors[currentNeighbors.length-1];
                if (!fuseNeighbor || fuseNeighbor.id === p.id) continue;

                // Perform merge: p into fuseNeighbor
                const sumP = p.valA + p.valB;
                const sumFuse = fuseNeighbor.valA + fuseNeighbor.valB;
                const totalSum = sumP + sumFuse;

                if (totalSum > 0) {
                    fuseNeighbor.r = (p.r * sumP + fuseNeighbor.r * sumFuse) / totalSum;
                    fuseNeighbor.c = (p.c * sumP + fuseNeighbor.c * sumFuse) / totalSum;
                }
                fuseNeighbor.valA += p.valA;
                fuseNeighbor.valB += p.valB;
                fuseNeighbor.sumVal = fuseNeighbor.valA + fuseNeighbor.valB;
                
                p.removed = true;
                totalMergedInLoop++;

                // Simplified graph update for this iteration's pass (doesn't affect Delaunay for next iter)
                // The key is that `activePoints` for the *next* Delaunay will be correct.
                // Remove p from fuseNeighbor's list (if it was there from previous Delaunay)
                neighborMap.get(fuseNeighbor.id)?.delete(p.id);
                // For all neighbors of p, remove p from their list and add fuseNeighbor
                pNeighborsIds.forEach(neighborIdOfP => {
                    if (neighborIdOfP !== fuseNeighbor.id) { // Don't add fuse to itself
                        neighborMap.get(neighborIdOfP)?.delete(p.id);
                        neighborMap.get(neighborIdOfP)?.add(fuseNeighbor.id);
                        neighborMap.get(fuseNeighbor.id)?.add(neighborIdOfP);
                    }
                });
                neighborMap.delete(p.id); // p is gone
            }
        }
        currentIteration++;
        if (progressCallback) progressCallback(currentIteration, totalMergedInLoop, config.voroserpMaxIter);
        if (totalMergedInLoop === 0) break; // No merges in this full pass

    } while (currentIteration < config.voroserpMaxIter);

    let finalPoints = points.filter(p => !p.removed);
    
    finalPoints.forEach(p => { // Recompute logRatio
        const valA_eff = p.valA + config.pseudocount;
        const valB_eff = p.valB + config.pseudocount;
        if (valA_eff > 0 && valB_eff > 0) p.logRatio = log(valA_eff / valB_eff, config.logBase);
        else if (valA_eff > 0) p.logRatio = Infinity;
        else if (valB_eff > 0) p.logRatio = -Infinity;
        else p.logRatio = 0;
    });

    const finiteLogRatios = finalPoints.map(p => p.logRatio).filter(lr => isFinite(lr));
    if (finiteLogRatios.length > 0) {
        const meanLogRatio = mean(finiteLogRatios);
        const maxFinite = Math.max(...finiteLogRatios, 0);
        const minFinite = Math.min(...finiteLogRatios, 0);
        finalPoints.forEach(p => {
            if (isFinite(p.logRatio)) p.logRatio -= meanLogRatio;
            else if (p.logRatio === Infinity) p.logRatio = (maxFinite - meanLogRatio) + 1 || 10;
            else if (p.logRatio === -Infinity) p.logRatio = (minFinite - meanLogRatio) - 1 || -10;
        });
    }
    return finalPoints;
}