// parser.js

function parseInput(inputSource, sourceMeta, format, isTriangular, callback, errorCallback, existingPointsMap = null) {
    // inputSource: File object, URL string, or demo file path string
    // sourceMeta: { type: 'file'/'url'/'demo', name: string, isGzipped: boolean, fileType: 'A'/'B'/'AB' }

    const processRawCSVString = (rawDataString, fileName) => {
        Papa.parse(rawDataString, {
            dynamicTyping: true,
            skipEmptyLines: true,
            // header: (format !== 'dense'), // Let's be more explicit below
            delimitersToGuess: [",", "\t", " "], // Helps PapaParse
            complete: (results) => {
                try {
                    let data = results.data;
                    if (results.errors.length > 0) {
                        console.warn(`CSV parsing warnings for ${fileName}:`, results.errors);
                        if (results.errors.some(e => e.code !== "UndetectableDelimiter" && e.code !== "TooFewFields" && e.code !== "TooManyFields")) {
                             errorCallback(`Critical CSV parsing errors for ${fileName}: ${results.errors.map(e => e.message).join(', ')}`);
                             return;
                        }
                    }
                    if (data.length === 0) {
                        errorCallback(`CSV data from ${fileName} is empty or unparseable.`);
                        return;
                    }

                    if (format === 'dense') {
                        // If data rows are single strings, it means delimiter wasn't auto-detected well.
                        // Try splitting them by common delimiters.
                        if (data.length > 0 && typeof data[0] === 'string') {
                            data = data.map(rowStr => rowStr.trim().split(/[\s,;\t]+/));
                        } else if (data.length > 0 && typeof data[0] === 'object' && !Array.isArray(data[0])) {
                            // If PapaParse used header:true incorrectly (e.g. on a headerless dense file)
                            data = data.map(objRow => Object.values(objRow));
                        }


                        const matrix = data.map(row => {
                            if (!Array.isArray(row)) { // Should be an array of strings/numbers by now
                                console.warn("Skipping unparseable dense row (not an array):", row); return [];
                            }
                            return row.map(val => (val === null || val === undefined || val === "" || isNaN(parseFloat(val))) ? 0 : parseFloat(val));
                        }).filter(row => row.length > 0);

                        if (matrix.length === 0 || (matrix[0] && matrix[0].length === 0)) {
                            errorCallback("Dense matrix is empty or fully unparseable after parsing."); return;
                        }
                        const numRows = matrix.length;
                        const numCols = matrix.reduce((max, row) => Math.max(max, row.length), 0);
                        const N = Math.max(numRows, numCols);
                        
                        const squareMatrix = Array(N).fill(null).map(() => Array(N).fill(0));
                        for (let i = 0; i < numRows; i++) {
                            for (let j = 0; j < (matrix[i] ? matrix[i].length : 0); j++) {
                                if (i < N && j < N) squareMatrix[i][j] = matrix[i][j];
                            }
                        }
                        if (isTriangular) {
                            for (let i = 0; i < N; i++) {
                                for (let j = i + 1; j < N; j++) {
                                     if (squareMatrix[i][j] !== 0 && squareMatrix[j][i] === 0) squareMatrix[j][i] = squareMatrix[i][j];
                                     else if (squareMatrix[j][i] !== 0 && squareMatrix[i][j] === 0) squareMatrix[i][j] = squareMatrix[j][i];
                                }
                            }
                        }
                        callback(squareMatrix, N, null);

                    } else { // Sparse formats
                        let pointsMap = existingPointsMap || new Map();
                        let maxRow = 0, maxCol = 0, headers = [], dataToParse = data, headerRowSkipped = false;

                        const firstRowIsLikelyHeader = data.length > 0 && Array.isArray(data[0]) && data[0].every(h => typeof h === 'string');
                        const firstRowHasSparseKeywords = firstRowIsLikelyHeader && data[0].map(h => h.toLowerCase().trim()).some(h => ['row','col','value','vala','valb'].includes(h));
                        
                        // Determine if first row should be treated as header for sparse
                        if (firstRowIsLikelyHeader && firstRowHasSparseKeywords) {
                            headers = data[0].map(h => h.toLowerCase().trim());
                            dataToParse = data.slice(1);
                            headerRowSkipped = true;
                        } else if (data.length > 0 && typeof data[0] === 'object' && !Array.isArray(data[0])) {
                             // PapaParse probably auto-detected headers (e.g. if file upload has header row)
                             headers = Object.keys(data[0]).map(h => h.toLowerCase().trim());
                             // dataToParse remains `data` as PapaParse already separated headers
                        }


                        const colMap = {};
                        ['row', 'col', 'vala', 'valb', 'value'].forEach(eh => {
                            const idx = headers.findIndex(h => h === eh || h.startsWith(eh));
                            if (idx !== -1) colMap[eh] = headers.length > 0 ? headers[idx] : eh; // eh is fallback if headers array is empty
                        });
                        
                        dataToParse.forEach((d_row, dataIdx) => {
                            let r_val, c_val, valA_val, valB_val, val_val;
                            let record = d_row;
                            // If d_row is a single string (common for fetched files where delimiter isn't comma)
                            if (Array.isArray(d_row) && d_row.length === 1 && typeof d_row[0] === 'string' && d_row[0].match(/[\s,;\t]/)) {
                                record = d_row[0].trim().split(/[\s,;\t]+/);
                            } else if (typeof d_row === 'string' && d_row.match(/[\s,;\t]/)) { // If d_row itself is the string
                                record = d_row.trim().split(/[\s,;\t]+/);
                            } else if (!Array.isArray(d_row) && typeof d_row === 'object' && d_row !== null) {
                                // Object from PapaParse (header:true was used)
                                record = d_row; 
                            } else if (!Array.isArray(d_row)){
                                console.warn(`Skipping unparseable sparse row ${dataIdx+(headerRowSkipped?2:1)}:`, d_row); return;
                            }
                            // At this point, `record` should be an array (if no headers) or an object (if headers)

                            const getField = (fieldName, defaultIndex) => {
                                if (headers.length > 0 && colMap[fieldName] && typeof record === 'object' && !Array.isArray(record)) {
                                    return record[colMap[fieldName]];
                                }
                                return Array.isArray(record) ? record[defaultIndex] : undefined;
                            };


                            r_val = getField('row', 0); c_val = getField('col', 1);
                            const r = parseInt(r_val); const c = parseInt(c_val);
                            if (isNaN(r) || isNaN(c) || r < 0 || c < 0) { console.warn(`Skipping row ${dataIdx+(headerRowSkipped?2:1)} (coords):`, d_row); return; }
                            maxRow = Math.max(maxRow, r); maxCol = Math.max(maxCol, c);
                            
                            let key = `${r}-${c}`, symKey = `${c}-${r}`;
                            let point = pointsMap.get(key);
                            if (!point) { point = { r,c,valA:0,valB:0,id:pointsMap.size }; pointsMap.set(key, point); }
                            
                            if (format === 'sparse_list_ab') {
                                valA_val = getField('vala', 2); valB_val = getField('valb', 3);
                                const valA = parseFloat(valA_val), valB = parseFloat(valB_val);
                                if (isNaN(valA)||isNaN(valB)) { console.warn(`Skipping (NaN AB):`, d_row); return; }
                                point.valA += valA; point.valB += valB;
                            } else { // sparse_individual
                                val_val = getField('value', 2);
                                const val = parseFloat(val_val);
                                if (isNaN(val)) { console.warn(`Skipping (NaN val):`, d_row); return; }
                                if (sourceMeta.fileType === 'A') point.valA += val; 
                                else if (sourceMeta.fileType === 'B') point.valB += val;
                            }

                            if (isTriangular && r !== c) {
                                let symPoint = pointsMap.get(symKey);
                                if (!symPoint) { symPoint = {r:c,c:r,valA:0,valB:0,id:pointsMap.size}; pointsMap.set(symKey, symPoint); }
                                if (format === 'sparse_list_ab') {
                                    const valA = parseFloat(valA_val), valB = parseFloat(valB_val);
                                     if (!isNaN(valA)) symPoint.valA += valA; 
                                     if (!isNaN(valB)) symPoint.valB += valB;
                                } else { 
                                    const val = parseFloat(val_val);
                                    if (!isNaN(val)) { 
                                        if (sourceMeta.fileType === 'A') symPoint.valA += val; 
                                        else if (sourceMeta.fileType === 'B') symPoint.valB += val;
                                    }
                                }
                            }
                        });
                        const N_eff = Math.max(maxRow, maxCol) + 1;
                        callback(Array.from(pointsMap.values()), N_eff, pointsMap);
                    }
                } catch (e) {
                    errorCallback(`Error processing CSV content from ${fileName}: ${e.message}\nStack: ${e.stack}`);
                }
            }
        });
    };

    if (sourceMeta.type === 'file') {
        // ... (file reading and GZip logic remains the same) ...
        if (!inputSource) { errorCallback("No file provided for file input."); return; }
        const reader = new FileReader();
        reader.onload = (e) => {
            let rawText = e.target.result;
            if (sourceMeta.isGzipped || inputSource.name.endsWith('.gz')) {
                try {
                    const byteArray = new Uint8Array(rawText);
                    rawText = pako.inflate(byteArray, { to: 'string' });
                } catch (gz_err) {
                    errorCallback(`GZip decompression failed for ${inputSource.name}: ${gz_err.message}`);
                    return;
                }
            }
            processRawCSVString(rawText, inputSource.name);
        };
        reader.onerror = () => errorCallback(`Error reading file ${inputSource.name}.`);
        
        if (sourceMeta.isGzipped || (inputSource && inputSource.name && inputSource.name.endsWith('.gz'))) {
            reader.readAsArrayBuffer(inputSource); 
        } else if (inputSource) {
            reader.readAsText(inputSource);
        } else {
            errorCallback("Invalid file input source.");
        }


    } else if (sourceMeta.type === 'url' || sourceMeta.type === 'demo') {
        // ... (fetch logic remains the same) ...
        if (!inputSource) { errorCallback("No URL or demo path provided."); return; }
        fetch(inputSource)
            .then(response => {
                if (!response.ok) throw new Error(`HTTP error! status: ${response.status} for ${inputSource}`);
                return sourceMeta.isGzipped || inputSource.endsWith('.gz') ? response.arrayBuffer() : response.text();
            })
            .then(dataContent => {
                let rawText = dataContent;
                if (sourceMeta.isGzipped || inputSource.endsWith('.gz')) {
                    try {
                        rawText = pako.inflate(new Uint8Array(dataContent), { to: 'string' });
                    } catch (gz_err) {
                        errorCallback(`GZip decompression failed for ${inputSource}: ${gz_err.message}`);
                        return;
                    }
                }
                processRawCSVString(rawText, inputSource);
            })
            .catch(fetchErr => errorCallback(`Fetching ${inputSource} failed: ${fetchErr.message}`));
    }
}


// parseDenseCSV is now primarily a wrapper for parseInput if you want to keep it separate
// or can be fully integrated. For this iteration, main.js will call parseInput directly
// for dense by setting format appropriately in sourceMeta.
function parseDenseCSV(fileOrData, isTriangular, callback, errorCallback) {
    // This function is now essentially a specific call to parseInput
    // We need to determine if fileOrData is a File object or raw string
    let sourceMeta;
    let inputSrc;

    if (typeof fileOrData === 'string') { // Raw CSV string (less likely for dense from UI now)
        sourceMeta = { type: 'string_data', name: 'dense_string_input', isGzipped: false, fileType: 'A_or_B_dense' }; // fileType isn't used by dense path in parseInput
        inputSrc = fileOrData;
         parseInput(inputSrc, sourceMeta, 'dense', isTriangular, callback, errorCallback);
    } else if (fileOrData instanceof File) { // File object
        sourceMeta = { type: 'file', name: fileOrData.name, isGzipped: fileOrData.name.endsWith('.gz'), fileType: 'A_or_B_dense' };
        inputSrc = fileOrData;
         parseInput(inputSrc, sourceMeta, 'dense', isTriangular, callback, errorCallback);
    } else {
        errorCallback("Invalid input to parseDenseCSV: Expected File object or raw string.");
    }
}