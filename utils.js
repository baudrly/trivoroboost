// utils.js

function seismicColormap(value, min, max) {
    if (min >= max) return value <= min ? 'rgb(0,0,255)' : 'rgb(255,0,0)'; // Blue for min, Red for max
    const mid = 0; // Seismic is often centered at 0 for log ratios
    let r, g, b;

    if (value < mid) { // Blue side
        const t = Math.max(0, Math.min(1, (value - min) / (mid - min || 1e-9))); // Normalize from min to mid
        r = Math.round(0 + 255 * (1 - t)); // Starts blue (0,0,255) -> white (255,255,255)
        g = Math.round(0 + 255 * (1 - t));
        b = 255;
    } else { // Red side
        const t = Math.max(0, Math.min(1, (value - mid) / (max - mid || 1e-9))); // Normalize from mid to max
        r = 255;
        g = Math.round(255 - 255 * t); // Starts white (255,255,255) -> red (255,0,0)
        b = Math.round(255 - 255 * t);
    }
    return `rgb(${Math.max(0,Math.min(255,r))},${Math.max(0,Math.min(255,g))},${Math.max(0,Math.min(255,b))})`;
}

function pastelPentineColormap(value, min, max) {
    // Original colors from notebook:
    // (120/350/2, 180/350/2, 230/350/2) -> approx rgb(0.17*255, 0.25*255, 0.32*255) -> rgb(43, 65, 83) (very dark)
    // (179/255, 205/255, 227/255) -> rgb(179, 205, 227) (light blue)
    // (1,1,1) -> rgb(255, 255, 255) (white)
    // (251/255, 180/255, 174/255) -> rgb(251, 180, 174) (light red)
    // (248/350/2, 120/350/2, 109/350/2) -> approx rgb(0.35*255, 0.17*255, 0.15*255) -> rgb(90, 43, 39) (dark red)
    // The original notebook values might be scaled differently. Let's use the RGB values for clarity.
    const colors = [
        { r: 120, g: 180, b: 230 }, // Light Blue-ish
        { r: 179, g: 205, b: 227 }, // Lighter Blue
        { r: 255, g: 255, b: 255 }, // White
        { r: 251, g: 180, b: 174 }, // Light Red
        { r: 248, g: 120, b: 109 }  // Salmon Red
    ];
    const numSegments = colors.length - 1;
    if (min >= max) return value <= min ? `rgb(${colors[0].r},${colors[0].g},${colors[0].b})` : `rgb(${colors[numSegments].r},${colors[numSegments].g},${colors[numSegments].b})`;
    
    const t_raw = (value - min) / (max - min || 1e-9);
    const t = Math.max(0, Math.min(1, t_raw)); // Clamp t between 0 and 1

    const segment = Math.min(numSegments - 1, Math.floor(t * numSegments));
    const segmentT = (t * numSegments) - segment;

    const r = Math.round(colors[segment].r + (colors[segment + 1].r - colors[segment].r) * segmentT);
    const g = Math.round(colors[segment].g + (colors[segment + 1].g - colors[segment].g) * segmentT);
    const b = Math.round(colors[segment].b + (colors[segment + 1].b - colors[segment].b) * segmentT);
    return `rgb(${r},${g},${b})`;
}


function redsColormap(value, min, max) {
    if (min >= max) return 'rgb(255,255,255)'; // white for min if range is 0
    const t = Math.max(0, Math.min(1, (value - min) / (max - min || 1e-9)));
    const r = 255;
    const g = Math.round(255 * (1 - t));
    const b = Math.round(255 * (1 - t));
    return `rgb(${r},${g},${b})`;
}

function bluesColormap(value, min, max) {
    if (min >= max) return 'rgb(255,255,255)';
    const t = Math.max(0, Math.min(1, (value - min) / (max - min || 1e-9)));
    const r = Math.round(255 * (1 - t));
    const g = Math.round(255 * (1 - t));
    const b = 255;
    return `rgb(${r},${g},${b})`;
}
function purplesColormap(value, min, max) {
    if (min >= max) return 'rgb(255,255,255)';
    const t = Math.max(0, Math.min(1, (value - min) / (max - min || 1e-9)));
    const r = Math.round(128 + 127 * t); // Light purple (255,200,255) to Dark (128,0,128) - reversed
    const g = Math.round(255 * (1-t));   // White (255) to Purple (128)
    const b = 255;                       // White (255) to Purple (128)
    // Let's try a common Purple scale: white -> light purple -> purple
    // White: (255,255,255), Purple: (128,0,128)
    const r_p = Math.round(255 - (255-128)*t);
    const g_p = Math.round(255 - 255*t);
    const b_p = Math.round(255 - (255-128)*t);
    return `rgb(${r_p},${g_p},${b_p})`;
}


function viridisColormap(value, min, max) {
    if (min >= max) return 'rgb(68,1,84)';
    const t = Math.max(0, Math.min(1, (value - min) / (max - min || 1e-9)));
    const c = [ [68,1,84], [59,82,139], [33,145,140], [94,201,98], [253,231,37] ]; // Standard Viridis stops
    const numSegments = c.length - 1;
    const segment = Math.min(numSegments - 1, Math.floor(t * numSegments));
    const segmentT = (t * numSegments) - segment;
    const r = Math.round(c[segment][0] + (c[segment+1][0] - c[segment][0]) * segmentT);
    const g = Math.round(c[segment][1] + (c[segment+1][1] - c[segment][1]) * segmentT);
    const b = Math.round(c[segment][2] + (c[segment+1][2] - c[segment][2]) * segmentT);
    return `rgb(${r},${g},${b})`;
}

function plasmaColormap(value, min, max) {
    if (min >= max) return 'rgb(13,8,135)';
    const t = Math.max(0, Math.min(1, (value - min) / (max - min || 1e-9)));
    const c = [ [13,8,135], [126,3,168], [214,72,99], [248,151,29], [240,249,33] ]; // Standard Plasma stops
    const numSegments = c.length - 1;
    const segment = Math.min(numSegments - 1, Math.floor(t * numSegments));
    const segmentT = (t * numSegments) - segment;
    const r = Math.round(c[segment][0] + (c[segment+1][0] - c[segment][0]) * segmentT);
    const g = Math.round(c[segment][1] + (c[segment+1][1] - c[segment][1]) * segmentT);
    const b = Math.round(c[segment][2] + (c[segment+1][2] - c[segment][2]) * segmentT);
    return `rgb(${r},${g},${b})`;
}


function getColor(value, minVal, maxVal, colormapName) {
    if (isNaN(value) || !isFinite(value)) return '#333333'; // Dark grey for NaN/Infinity
    
    // For sequential colormaps used with single matrix data, map to [0,1]
    let t_val = value;
    let t_min = minVal;
    let t_max = maxVal;

    // Diverging colormaps (seismic, pastelpentine) are usually centered around 0
    // Sequential ones (reds, blues, viridis, plasma, purples) for single matrix data often start at 0 or min data value

    switch (colormapName) {
        case 'reds': return redsColormap(t_val, t_min, t_max);
        case 'blues': return bluesColormap(t_val, t_min, t_max);
        case 'purples': return purplesColormap(t_val, t_min, t_max);
        case 'viridis_single': return viridisColormap(t_val, t_min, t_max); // Use same func, name indicates context
        case 'plasma_single': return plasmaColormap(t_val, t_min, t_max);
        case 'viridis': return viridisColormap(value, minVal, maxVal); // For logRatio context
        case 'plasma': return plasmaColormap(value, minVal, maxVal);   // For logRatio context
        case 'custom_pastelpentine': return pastelPentineColormap(value, minVal, maxVal);
        case 'seismic': default: return seismicColormap(value, minVal, maxVal);
    }
}

function addInfinityPoints(pointsArray, shape) {
    const N = Math.max(shape[0], shape[1]); 
    const infinityCoords = [
        [-1.5 * N, -1.5 * N], [-1.5 * N, 2.5 * N],
        [2.5 * N, -1.5 * N], [2.5 * N, 2.5 * N]
    ];
    let currentId = pointsArray.length > 0 ? Math.max(...pointsArray.map(p => p.id)) + 1 : 0;
    infinityCoords.forEach(pCoords => {
        pointsArray.push({ 
            r: pCoords[0], c: pCoords[1], 
            valA: 0, valB: 0, logRatio: 0, sumVal: 0, 
            id: currentId++, originalIndex: -1, 
            isInfinity: true 
        });
    });
    return pointsArray;
}

function mean(arr) {
    if (!arr || arr.length === 0) return 0;
    return arr.reduce((sum, val) => sum + val, 0) / arr.length;
}

function log(val, base) {
    if (val <= 0) return NaN; // Log of non-positive is NaN
    if (base === '10') return Math.log10(val);
    if (base === 'e') return Math.log(val);
    return Math.log2(val);
}

function setStatus(message, type = "info") {
    const statusElement = document.getElementById('statusMessages');
    statusElement.textContent = message;
    statusElement.className = `status-bar ${type}`;
}