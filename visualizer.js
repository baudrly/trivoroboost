// visualizer.js
function drawVisualization(canvasId, colorbarCanvasId, pointsData, N_eff, config, mapType, title) {
    const canvas = document.getElementById(canvasId);
    const ctx = canvas.getContext('2d');
    
    canvas.width = config.canvasSize;
    canvas.height = config.canvasSize;
    
    const scaleFactor = config.canvasSize / N_eff;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#1a1a2e'; 
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const pointsForDelaunayInput = pointsData.filter(p => 
        !p.isInfinity && 
        isFinite(p.c) && isFinite(p.r) &&
        p.r >= 0 && p.c >=0 && p.r < N_eff && p.c < N_eff // Ensure within matrix bounds for drawing
    );
    
    const delaunayCoords = pointsForDelaunayInput.map(p => [(p.c + 0.5) * scaleFactor, (p.r + 0.5) * scaleFactor]);

    if (delaunayCoords.length < 3) {
        setStatus(`Not enough points for ${title} (need at least 3).`, "warning");
        return;
    }
    
    const delaunay = d3.Delaunay.from(delaunayCoords); 
    const voronoi = delaunay.voronoi([0, 0, config.canvasSize, config.canvasSize]);

    ctx.lineWidth = 0.5;

    let currentMin = config.colorMinLogRatio;
    let currentMax = config.colorMaxLogRatio;
    let currentColormap = config.colormapLogRatio;

    if (mapType === 'A' || mapType === 'B') {
        currentColormap = config.colormapSingle;
        if (config.autoScaleSingleMatrix) {
            const allVals = pointsForDelaunayInput.map(p => mapType === 'A' ? p.valA : p.valB);
            if (allVals.length > 0) {
                currentMin = Math.min(...allVals);
                currentMax = Math.max(...allVals);
                if (currentMin === currentMax) currentMax = currentMin + 1;
            } else {
                currentMin = 0; currentMax = 1; // Default if no points
            }
        } else {
            currentMin = config.colorMinSingle;
            currentMax = config.colorMaxSingle;
        }
    }
    
    for (let i = 0; i < pointsForDelaunayInput.length; i++) { 
        const point = pointsForDelaunayInput[i]; 
        const polygon = voronoi.cellPolygon(i); 

        if (polygon) {
            ctx.beginPath();
            ctx.moveTo(polygon[0][0], polygon[0][1]);
            for (let j = 1; j < polygon.length; j++) {
                ctx.lineTo(polygon[j][0], polygon[j][1]);
            }
            ctx.closePath();
            
            let valueToColor;
            if (mapType === 'A') valueToColor = point.valA;
            else if (mapType === 'B') valueToColor = point.valB;
            else valueToColor = point.logRatio; // Naive or Binned LogRatio
            
            ctx.fillStyle = getColor(valueToColor, currentMin, currentMax, currentColormap);
            ctx.fill();
            if (config.showVoronoiEdges) {
                ctx.strokeStyle = '#555e70'; 
                ctx.stroke();
            }
        }
    }

    if (config.showDelaunay) {
        ctx.beginPath();
        // Manual triangle rendering:
        for (let i = 0, n = delaunay.triangles.length / 3; i < n; ++i) {
            const t0 = delaunay.triangles[i * 3];
            const t1 = delaunay.triangles[i * 3 + 1];
            const t2 = delaunay.triangles[i * 3 + 2];
            ctx.moveTo(delaunay.points[t0 * 2], delaunay.points[t0 * 2 + 1]);
            ctx.lineTo(delaunay.points[t1 * 2], delaunay.points[t1 * 2 + 1]);
            ctx.lineTo(delaunay.points[t2 * 2], delaunay.points[t2 * 2 + 1]);
            ctx.closePath();
        }
        ctx.strokeStyle = 'rgba(150, 150, 180, 0.25)';
        ctx.lineWidth = 0.5;
        ctx.stroke();
    }
    
    if (config.showPoints) {
        ctx.fillStyle = 'rgba(240, 240, 240, 0.6)';
        pointsForDelaunayInput.forEach(p => { 
             ctx.beginPath();
             ctx.arc((p.c + 0.5) * scaleFactor, (p.r + 0.5) * scaleFactor, config.pointSize, 0, 2 * Math.PI);
             ctx.fill();
        });
    }
    
    drawColorbar(colorbarCanvasId, currentColormap, currentMin, currentMax);
}


function drawColorbar(canvasId, colormapName, minVal, maxVal) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);
    const gradient = ctx.createLinearGradient(0, height - 10, 0, 10); 

    const numStops = 20;
    for (let i = 0; i <= numStops; i++) {
        const value = minVal + (maxVal - minVal) * (i / numStops);
        gradient.addColorStop(i / numStops, getColor(value, minVal, maxVal, colormapName));
    }

    ctx.fillStyle = gradient;
    ctx.fillRect(15, 10, width - 35, height - 20); 

    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--border-color').trim();
    ctx.lineWidth = 1;
    ctx.strokeRect(15, 10, width - 35, height - 20); 

    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-color').trim();
    ctx.font = '10px Roboto';
    const numTicks = Math.min(5, Math.floor((height-20)/20)); // Adjust numTicks based on height
    if (numTicks < 2) return; // Not enough space for good labels

    for (let i = 0; i <= numTicks; i++) {
        const value = minVal + (maxVal - minVal) * (i / numTicks);
        const yPos = (height - 20) - ((height - 20) * (i / numTicks)) + 10;
        
        let labelText = value.toPrecision(2);
        if (Math.abs(value) > 1000 || (Math.abs(value) < 0.01 && value !==0) ) {
            labelText = value.toExponential(1);
        } else if (Math.abs(value) < 1 && value !== 0) {
            labelText = value.toFixed(2);
        } else {
            labelText = value.toFixed(1);
        }

        ctx.fillText(labelText, width - 18, yPos + 4); 
        ctx.beginPath();
        ctx.moveTo(15 - 2, yPos); // Tick on left of bar
        ctx.lineTo(15 + 2, yPos);
        ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-muted').trim();
        ctx.stroke();
    }
}