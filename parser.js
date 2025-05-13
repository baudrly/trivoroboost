// parser.js

function parseCSVFile(file, fileType, // 'A', 'B', or 'AB'
                                isTriangular, callback, errorCallback, existingPointsMap = null) {
    if (!file) {
        errorCallback("No file selected.");
        return;
    }

    const processParsedData = (results) => {
        try {
            let data = results.data;
            if (results.errors.length > 0) {
                console.warn(`CSV parsing warnings for ${file.name}:`, results.errors);
                // Allow UndetectableDelimiter if data is otherwise present and looks multi-column
                if (results.errors.some(e => e.code !== "UndetectableDelimiter" && e.code !== "TooFewFields" && e.code !== "TooManyFields")) {
                    errorCallback(`Critical CSV parsing errors for ${file.name}: ${results.errors.map(e => e.message).join(', ')}`);
                    return;
                }
            }
            if (data.length === 0) {
                errorCallback(`CSV file ${file.name} is empty or unparseable.`);
                return;
            }

            if (format === 'dense') {
                const matrix = data.map(row => {
                    // If a row is not an object (e.g., after trying different delimiters, it might be a single string),
                    // try splitting it. This handles cases where PapaParse defaults to comma but it's space/tab.
                    if (typeof row === 'string') {
                        row = row.trim().split(/[\s,;\t]+/); // Split by common delimiters
                    } else if (!Array.isArray(row) && typeof row === 'object' && row !== null) {
                        // If it's an object (e.g. from header:true on a headerless file), take its values
                        row = Object.values(row);
                    } else if (!Array.isArray(row)) { // If still not an array, something is wrong
                        console.warn("Skipping unparseable dense row:", row);
                        return []; // Return empty array to be filtered out
                    }
                    return row.map(val => (val === null || val === undefined || val === "" || isNaN(parseFloat(val))) ? 0 : parseFloat(val));
                }).filter(row => row.length > 0); // Filter out rows that became empty

                if (matrix.length === 0 || matrix[0].length === 0) {
                    errorCallback("Dense matrix is empty or fully unparseable after parsing."); return;
                }
                
                const numRows = matrix.length;
                const numCols = matrix.reduce((max, row) => Math.max(max, row.length), 0);
                const N = Math.max(numRows, numCols);
                
                const squareMatrix = Array(N).fill(null).map(() => Array(N).fill(0));
                for (let i = 0; i < numRows; i++) {
                    for (let j = 0; j < (matrix[i] ? matrix[i].length : 0); j++) {
                        if (i < N && j < N) { // Ensure within bounds of squareMatrix
                           squareMatrix[i][j] = matrix[i][j];
                        }
                    }
                }

                if (isTriangular) {
                    for (let i = 0; i < N; i++) {
                        for (let j = i + 1; j < N; j++) {
                            squareMatrix[j][i] = squareMatrix[i][j]; // Symmetrize
                        }
                    }
                }
                callback(squareMatrix, N, null);

            } else { // Sparse formats
                let pointsMap = existingPointsMap || new Map();
                let maxRow = 0;
                let maxCol = 0;
                let headers = [];
                let dataToParse = data;
                let headerRowSkipped = false;

                // Infer headers for sparse
                if (data.length > 0 && typeof data[0] === 'object' && !Array.isArray(data[0])) { // PapaParse used header:true
                    headers = Object.keys(data[0]).map(h => h.toLowerCase().trim());
                } else if (data.length > 0 && Array.isArray(data[0]) && data[0].every(h => typeof h === 'string')) {
                    // If first row looks like headers (all strings)
                    const firstRowLower = data[0].map(h => h.toLowerCase().trim());
                    if (firstRowLower.includes('row') && firstRowLower.includes('col')) {
                        headers = firstRowLower;
                        dataToParse = data.slice(1);
                        headerRowSkipped = true;
                    }
                }


                const colMap = {};
                const expectedSparseAB = ['row', 'col', 'vala', 'valb'];
                const expectedSparseIndividual = ['row', 'col', 'value'];

                if (headers.length > 0) {
                    expectedSparseAB.forEach(eh => {
                        const idx = headers.findIndex(h => h === eh || h.startsWith(eh)); // Allow "valueA" too
                        if (idx !== -1) colMap[eh] = headers[idx]; // Store original header name
                    });
                     expectedSparseIndividual.forEach(eh => {
                        if (!colMap[eh]) { // Only if not already mapped by sparse_list_ab
                            const idx = headers.findIndex(h => h === eh || h.startsWith(eh));
                            if (idx !== -1) colMap[eh] = headers[idx];
                        }
                    });
                }
                
                dataToParse.forEach((d_row, dataIdx) => {
                    let r_val, c_val, valA_val, valB_val, val_val;
                    let record = d_row;

                    // If d_row is an array (no headers or delimiter issue made it an array of strings)
                    if (Array.isArray(d_row) && d_row.length > 0 && typeof d_row[0] === 'string' && d_row[0].includes(' ')) {
                         // This looks like a single string that needs splitting
                        record = d_row[0].trim().split(/[\s,;\t]+/);
                    } else if (!Array.isArray(d_row) && typeof d_row === 'object' && d_row !== null) {
                        // This is an object, use colMap or assume d.row etc.
                        record = d_row;
                    } else if (!Array.isArray(d_row)) {
                        console.warn(`Skipping unparseable sparse row ${dataIdx + (headerRowSkipped?2:1)}:`, d_row); return;
                    }


                    if (format === 'sparse_list_ab') {
                        r_val = colMap['row'] ? record[colMap['row']] : record[0];
                        c_val = colMap['col'] ? record[colMap['col']] : record[1];
                        valA_val = colMap['vala'] ? record[colMap['vala']] : record[2];
                        valB_val = colMap['valb'] ? record[colMap['valb']] : record[3];
                    } else { // sparse_individual
                        r_val = colMap['row'] ? record[colMap['row']] : record[0];
                        c_val = colMap['col'] ? record[colMap['col']] : record[1];
                        val_val = colMap['value'] ? record[colMap['value']] : record[2];
                    }

                    const r = parseInt(r_val);
                    const c = parseInt(c_val);

                    if (isNaN(r) || isNaN(c) || r < 0 || c < 0) {
                        console.warn(`Skipping row ${dataIdx + (headerRowSkipped?2:1)} (invalid/missing coordinates):`, d_row); return;
                    }

                    maxRow = Math.max(maxRow, r);
                    maxCol = Math.max(maxCol, c);
                    
                    let key = `${r}-${c}`;
                    let symKey = `${c}-${r}`;

                    let point = pointsMap.get(key);
                    if (!point) {
                        point = { r, c, valA: 0, valB: 0, id: pointsMap.size };
                        pointsMap.set(key, point);
                    }
                    
                    if (format === 'sparse_list_ab') {
                        const valA = parseFloat(valA_val);
                        const valB = parseFloat(valB_val);
                        if (isNaN(valA) || isNaN(valB)) { console.warn(`Skipping row ${dataIdx+(headerRowSkipped?2:1)} (NaN valA/valB):`, d_row); return; }
                        point.valA += valA;
                        point.valB += valB;
                    } else { // sparse_individual
                        const val = parseFloat(val_val);
                        if (isNaN(val)) { console.warn(`Skipping row ${dataIdx+(headerRowSkipped?2:1)} (NaN value):`, d_row); return; }
                        if (existingPointsMap === null) { // Matrix A
                            point.valA += val;
                        } else { // Matrix B
                            point.valB += val;
                        }
                    }

                    if (isTriangular && r !== c) {
                        let symPoint = pointsMap.get(symKey);
                        if (!symPoint) {
                            symPoint = { r:c, c:r, valA: 0, valB: 0, id: pointsMap.size };
                            pointsMap.set(symKey, symPoint);
                        }
                        if (format === 'sparse_list_ab') {
                            const valA = parseFloat(valA_val); // re-parse for symPoint if it was newly created
                            const valB = parseFloat(valB_val);
                             if (!isNaN(valA)) symPoint.valA += valA;
                             if (!isNaN(valB)) symPoint.valB += valB;
                        } else { 
                            const val = parseFloat(val_val);
                            if (!isNaN(val)) {
                                if (existingPointsMap === null) symPoint.valA += val;
                                else symPoint.valB += val;
                            }
                        }
                    }
                });
                
                const N_eff = Math.max(maxRow, maxCol) + 1;
                callback(Array.from(pointsMap.values()), N_eff, pointsMap);
            }
        } catch (e) {
            errorCallback(`Error processing CSV ${file.name}: ${e.message}\nStack: ${e.stack}`);
        }
    };

    const format = document.getElementById('format').value; // Get format from UI

    Papa.parse(file, {
        header: (format !== 'dense'), // Only use header:true for sparse formats
        dynamicTyping: true,
        skipEmptyLines: true,
        delimitersToGuess: [",", "\t", " "], // Explicitly tell PapaParse to try these
        complete: processParsedData,
        error: (error) => {
            errorCallback(`PapaParse error for ${file.name}: ${error.message}`);
        }
    });
}


// Dense CSV parsing (original logic for when format is 'dense')
// This function is now called within main.js if format is 'dense',
// and parseCSVFile handles the sparse logic.
function parseDenseCSV(file, isTriangular, callback, errorCallback) {
     Papa.parse(file, {
        dynamicTyping: true,
        skipEmptyLines: true,
        delimitersToGuess: [",", "\t", " "], // Try common delimiters
        complete: function(results) {
            try {
                let data = results.data;
                if (results.errors.length > 0) {
                    console.warn("Dense CSV parsing warnings:", results.errors);
                     if (results.errors.some(e => e.code !== "UndetectableDelimiter" && e.code !== "TooFewFields" && e.code !== "TooManyFields")) {
                        errorCallback(`Critical dense CSV parsing errors: ${results.errors.map(e => e.message).join(', ')}`);
                        return;
                    }
                }
                if (data.length === 0) {
                    errorCallback("Dense CSV file is empty or unparseable.");
                    return;
                }
                
                // Convert to numeric matrix, handling potential string rows if delimiter was guessed wrong initially
                let matrix = data.map(row_anytype => {
                    let row_arr;
                    if (typeof row_anytype === 'string') {
                        row_arr = row_anytype.trim().split(/[\s,;\t]+/);
                    } else if (Array.isArray(row_anytype)) {
                        row_arr = row_anytype;
                    } else if (typeof row_anytype === 'object' && row_anytype !== null) {
                        row_arr = Object.values(row_anytype);
                    } else {
                        console.warn("Skipping unparseable dense row:", row_anytype);
                        return [];
                    }
                    return row_arr.map(val => (val === null || val === undefined || val === "" || isNaN(parseFloat(val))) ? 0 : parseFloat(val));
                }).filter(row => row.length > 0);


                if (matrix.length === 0 || matrix[0].length === 0) {
                    errorCallback("Dense matrix is empty or fully unparseable after parsing."); return;
                }

                const numRows = matrix.length;
                const numCols = matrix.reduce((max, row) => Math.max(max, row.length), 0);
                const N = Math.max(numRows, numCols);
                
                const squareMatrix = Array(N).fill(null).map(() => Array(N).fill(0));
                for (let i = 0; i < numRows; i++) {
                    for (let j = 0; j < (matrix[i] ? matrix[i].length : 0); j++) {
                         if (i < N && j < N) {
                           squareMatrix[i][j] = matrix[i][j];
                        }
                    }
                }

                if (isTriangular) {
                    for (let i = 0; i < N; i++) {
                        for (let j = i + 1; j < N; j++) {
                            // Ensure squareMatrix[i][j] has a value before assigning to symmetric position
                            if (squareMatrix[i][j] !== 0 && squareMatrix[j][i] === 0) { 
                                squareMatrix[j][i] = squareMatrix[i][j];
                            } else if (squareMatrix[j][i] !== 0 && squareMatrix[i][j] === 0) {
                                squareMatrix[i][j] = squareMatrix[j][i];
                            }
                        }
                    }
                }
                callback(squareMatrix, N);
            } catch (e) {
                errorCallback("Error processing dense CSV data: " + e.message + "\nStack: " + e.stack);
            }
        },
        error: function(error) {
            errorCallback("PapaParse error for dense CSV: " + error.message);
        }
    });
}