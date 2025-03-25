"use client";

import React, { useState, useEffect, useRef } from "react";
import mammoth from 'mammoth';

export default function Home() {
  const [text, setText] = useState("");
  const [words, setWords] = useState<string[]>([]);
  const [isReading, setIsReading] = useState(false);
  const [currentWordIndex, setCurrentWordIndex] = useState(0);
  const [wpm, setWpm] = useState(300);
  const [wordsAtATime, setWordsAtATime] = useState(1);
  const [fontSize, setFontSize] = useState(36);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [progress, setProgress] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [showTextInput, setShowTextInput] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [pdfText, setPdfText] = useState<string | null>(null);

  // PDF.js se cargará de forma dinámica solo cuando sea necesario
  const loadPdfJS = async () => {
    try {
      const pdfjsLib = await import('pdfjs-dist');
      // Usar el worker que hemos descargado en la carpeta pública
      pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf-worker/pdf.worker.min.js';
      return pdfjsLib;
    } catch (error) {
      console.error('Error al cargar PDF.js:', error);
      throw error;
    }
  };

  useEffect(() => {
    // Clean up timer when component unmounts
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    // Calculate progress
    if (words.length > 0) {
      setProgress((currentWordIndex / words.length) * 100);
    }
  }, [currentWordIndex, words]);

  useEffect(() => {
    // Reset the timer when wpm changes or reading state changes
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (isReading && words.length > 0) {
      const intervalMS = 60000 / wpm;
      timerRef.current = setInterval(() => {
        setCurrentWordIndex((prev: number) => {
          if (prev + 1 >= words.length) {
            // Stop reading when reaching the end
            setIsReading(false);
            if (timerRef.current) {
              clearInterval(timerRef.current);
            }
            return prev;
          }
          return prev + 1;
        });
      }, intervalMS);
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [isReading, wpm, words.length]);

  // Función para procesar el texto por lotes para manejar textos grandes
  const processText = (inputText: string) => {
    // Eliminar saltos de línea y dividir por espacios
    const wordsArray = inputText
      .replace(/[\r\n]+/g, " ")
      .split(/\s+/)
      .filter((word: string) => word.length > 0);
    
    return wordsArray;
  };

  const startReading = () => {
    if (text.trim() === "") return;
    
    // Si ya hay palabras procesadas, usa esas
    if (words.length === 0) {
      // Procesar el texto primero
      const processedWords = processText(text);
      setWords(processedWords);
    }
    
    setIsReading(true);
    setIsPaused(false);
    setShowTextInput(false);
  };

  const pauseReading = () => {
    setIsReading(false);
    setIsPaused(true);
  };

  const resetReading = () => {
    setIsReading(false);
    setIsPaused(false);
    setCurrentWordIndex(0);
  };

  const showInputArea = () => {
    setIsReading(false);
    setIsPaused(false);
    setShowTextInput(true);
  };

  const getCurrentWord = () => {
    if (words.length === 0) return "";
    
    if (wordsAtATime === 1) {
      return words[currentWordIndex] || "";
    } else {
      // Return multiple words
      return words
        .slice(
          currentWordIndex,
          Math.min(currentWordIndex + wordsAtATime, words.length)
        )
        .join(" ");
    }
  };

  // Genera un color dinámico para la letra en el centro de la palabra
  const getColoredWord = () => {
    const word = getCurrentWord();
    if (!word) return "";
    
    if (wordsAtATime > 1) {
      return word; // No destacamos una letra cuando son varias palabras
    }
    
    // Para una sola palabra, ya no destacamos el centro con color rojo
    // Simplemente devolvemos la palabra completa
    return <>{word}</>;
  };

  // Procesar archivo PDF con una solución robusta alternativa
  const processPdfFile = async (file: File): Promise<string> => {
    try {
      setLoadingMessage("Iniciando procesamiento de PDF...");
      
      // Enfoque simplificado usando FileReader para extraer contenido de texto
      return new Promise((resolve) => {
        const reader = new FileReader();
        
        reader.onload = async (event) => {
          try {
            setLoadingMessage("Analizando contenido del PDF...");
            
            // Tomamos el resultado como ArrayBuffer y lo convertimos a Uint8Array
            const arrayBuffer = event.target?.result as ArrayBuffer;
            const uint8Array = new Uint8Array(arrayBuffer);
            
            // Extraer fragmentos de texto del PDF
            let pdfText = '';
            let textChunks = [];
            
            // Buscar patrones de texto en archivos PDF
            // Buscamos ocurrencias de texto entre paréntesis de la forma "(texto)"
            // y patrones de texto como "BT ... ET" (Begin Text / End Text)
            for (let i = 0; i < uint8Array.length - 4; i++) {
              // Buscar secuencia "(" + texto + ")"
              if (uint8Array[i] === 0x28) { // "("
                let textChunk = '';
                let j = i + 1;
                
                // Leer hasta encontrar ")" no escapado
                while (j < uint8Array.length && uint8Array[j] !== 0x29) {
                  // Añadir carácter al chunk si no es un byte de control
                  if (uint8Array[j] >= 0x20 && uint8Array[j] <= 0x7E) {
                    textChunk += String.fromCharCode(uint8Array[j]);
                  }
                  j++;
                }
                
                // Si encontramos algo sustancial (más de 1 carácter), lo añadimos
                if (textChunk.length > 1) {
                  textChunks.push(textChunk);
                }
              }
            }
            
            setLoadingMessage("Procesando texto extraído...");
            
            // Agrupar chunks de texto para formar oraciones
            if (textChunks.length > 0) {
              // Filtrar chunks que parecen ser partes de contenido real
              const contentChunks = textChunks.filter(chunk => 
                // Filtrar chunks que parezcan palabras o frases (no solo caracteres aislados)
                /[a-zA-Z]{2,}/.test(chunk) && 
                // Evitar chunks que sean solo números o valores aislados
                !/^[\d.]+$/.test(chunk) &&
                // Evitar chunks que parezcan metadata
                !/^(Tj|TJ|Helvetica|Arial|Font|Page|http)/.test(chunk)
              );
              
              // Unir chunks en texto
              pdfText = contentChunks.join(' ')
                // Reemplazar secuencias unicode escapadas
                .replace(/\\(\d{3})/g, (match, code) => {
                  return String.fromCharCode(parseInt(code, 8));
                })
                // Limpiar caracteres no imprimibles
                .replace(/[^\x20-\x7E\n]/g, ' ')
                // Normalizar espacios
                .replace(/\s+/g, ' ');
            }
            
            // Verificar si extrajimos suficiente texto
            if (pdfText.length > 100) {
              setLoadingMessage("Texto extraído exitosamente.");
              resolve(pdfText);
            } else {
              // Intentar extracción básica como texto plano
              try {
                const textDecoder = new TextDecoder('utf-8');
                let rawText = textDecoder.decode(arrayBuffer);
                
                // Limpiar el texto crudo para extraer contenido legible
                rawText = rawText
                  .replace(/[^\x20-\x7E\n]/g, ' ')
                  .replace(/\s+/g, ' ')
                  .trim();
                
                if (rawText.length > 100) {
                  setLoadingMessage("Texto extraído usando método alternativo.");
                  resolve(rawText);
                } else {
                  // Si todo falla, mostrar mensaje de error amigable
                  setLoadingMessage("No se pudo extraer texto automáticamente.");
                  resolve("No se pudo extraer texto automáticamente de este PDF. Por favor, copia y pega el contenido manualmente. " +
                         "Puedes abrir el PDF en tu visor preferido, seleccionar todo (Ctrl+A), copiar (Ctrl+C) y pegar aquí (Ctrl+V).");
                }
              } catch (e) {
                console.error("Error en extracción de texto plano:", e);
                setLoadingMessage("Error en procesamiento de PDF.");
                resolve("Error al procesar este PDF. Por favor, copia y pega el contenido manualmente.");
              }
            }
          } catch (error) {
            console.error("Error al analizar PDF:", error);
            resolve("Error al procesar el PDF: " + (error instanceof Error ? error.message : "Error desconocido"));
          }
        };
        
        reader.onerror = (error) => {
          console.error("Error al leer el archivo:", error);
          resolve("Error al leer el archivo PDF. Por favor, intenta con otro archivo.");
        };
        
        // Leer el archivo como ArrayBuffer
        reader.readAsArrayBuffer(file);
      });
    } catch (error) {
      console.error("Error al procesar PDF:", error);
      return "Error al procesar el archivo PDF. Por favor, intenta con otro archivo o copia y pega el texto manualmente.";
    }
  };

  // Procesar archivo DOCX
  const processDocxFile = async (file: File): Promise<string> => {
    setLoadingMessage("Procesando documento Word...");
    
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      
      reader.onload = async (event) => {
        try {
          const arrayBuffer = event.target?.result as ArrayBuffer;
          
          // Usar mammoth para extraer el texto del documento DOCX
          const result = await mammoth.extractRawText({
            arrayBuffer: arrayBuffer
          });
          
          resolve(result.value);
        } catch (error) {
          console.error('Error al procesar DOCX:', error);
          reject('Error al procesar el archivo DOCX');
        }
      };
      
      reader.onerror = () => {
        reject('Error al leer el archivo');
      };
      
      reader.readAsArrayBuffer(file);
    });
  };

  // Procesar archivo TXT
  const processTxtFile = (file: File): Promise<string> => {
    setLoadingMessage("Procesando archivo de texto...");
    
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      
      reader.onload = (event) => {
        const text = event.target?.result as string;
        resolve(text);
      };
      
      reader.onerror = () => {
        reject('Error al leer el archivo de texto');
      };
      
      reader.readAsText(file);
    });
  };

  // Determinar el tipo de archivo y procesarlo adecuadamente
  const processFile = async (file: File) => {
    try {
      setIsLoading(true);
      setPdfText(null); // Limpiar cualquier mensaje anterior
      let extractedText = "";
      
      // Procesar según el tipo de archivo
      const fileName = file.name.toLowerCase();
      
      if (fileName.endsWith('.pdf')) {
        extractedText = await processPdfFile(file);
      } else if (fileName.endsWith('.docx')) {
        extractedText = await processDocxFile(file);
      } else if (fileName.endsWith('.doc')) {
        // Para archivos .doc antiguos, mostrar mensaje de que se recomienda .docx
        extractedText = "Los archivos .doc antiguos no son compatibles directamente. " +
                       "Por favor, guarda el documento como .docx y vuelve a intentarlo, " +
                       "o copia y pega el contenido directamente en el área de texto.";
      } else {
        extractedText = await processTxtFile(file);
      }
      
      // Establecer el texto extraído
      setText(extractedText);
    } catch (error) {
      console.error('Error al procesar el archivo:', error);
      setText(`Error al procesar el archivo: ${error}`);
    } finally {
      setIsLoading(false);
      setLoadingMessage("");
    }
  };

  // Manejar carga de archivo de texto
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    processFile(file);
  };

  // Eventos para drag & drop
  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      const file = files[0];
      // Verificar que sea un tipo de archivo aceptado
      if (
        file.type === "text/plain" || 
        file.type === "text/markdown" || 
        file.type === "application/pdf" ||
        file.name.endsWith(".docx") || 
        file.name.endsWith(".doc") ||
        file.name.endsWith(".txt") ||
        file.name.endsWith(".md")
      ) {
        processFile(file);
      }
    }
  };

  // Manejar clic en área de drop para activar el input file
  const handleDropAreaClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
      <main className="flex-grow container mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold text-center mb-8 text-gray-800 dark:text-white">
          RocketReader 🚀
        </h1>

        {/* Initial Text Input */}
        {showTextInput ? (
          <div className="max-w-3xl mx-auto bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-8">
            <h2 className="text-xl font-semibold mb-4 text-gray-700 dark:text-gray-200">
              Pega tu texto para empezar a leer
            </h2>
            <textarea
              className="w-full h-64 p-4 border border-gray-300 dark:border-gray-600 rounded-lg 
                         focus:ring-2 focus:ring-blue-500 focus:border-transparent
                         bg-white dark:bg-gray-700 text-gray-800 dark:text-white"
              value={text}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setText(e.target.value)}
              placeholder="Pega aquí el texto que quieres leer rápidamente..."
            />
            
            {/* Mostrar instrucciones si detectamos un PDF */}
            {pdfText && (
              <div className="mt-4 p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
                <div 
                  className="prose dark:prose-invert max-w-none text-sm"
                  dangerouslySetInnerHTML={{ __html: pdfText.replace(/\n/g, '<br>') }}
                />
              </div>
            )}
            
            {/* Área para arrastrar y soltar archivos */}
            <div 
              className={`mt-4 mb-4 border-2 border-dashed rounded-lg p-6 text-center cursor-pointer
                         transition-colors duration-200 ${
                           isDragging 
                             ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20" 
                             : isLoading 
                                ? "border-yellow-500 bg-yellow-50 dark:bg-yellow-900/20"
                                : "border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700/30"
                         }`}
              onDragEnter={handleDragEnter}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={handleDropAreaClick}
            >
              {isLoading ? (
                <div className="flex flex-col items-center justify-center">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-yellow-500"></div>
                  <p className="mt-3 text-sm font-medium text-gray-700 dark:text-gray-300">
                    {loadingMessage || "Procesando archivo..."}
                  </p>
                </div>
              ) : (
                <>
                  <svg 
                    xmlns="http://www.w3.org/2000/svg" 
                    className="h-12 w-12 mx-auto text-gray-400 dark:text-gray-500"
                    fill="none" 
                    viewBox="0 0 24 24" 
                    stroke="currentColor"
                  >
                    <path 
                      strokeLinecap="round" 
                      strokeLinejoin="round" 
                      strokeWidth={1.5} 
                      d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" 
                    />
                  </svg>
                  <p className="mt-3 text-sm font-medium text-gray-700 dark:text-gray-300">
                    {isDragging 
                      ? "Suelta el archivo aquí..." 
                      : "Arrastra y suelta tu archivo de texto aquí"}
                  </p>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    o haz clic para seleccionar archivo
                  </p>
                </>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.md,.doc,.docx,.pdf"
                onChange={handleFileUpload}
                className="hidden"
                disabled={isLoading}
              />
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                Soporta archivos .txt, .md, .docx y .pdf
              </p>
            </div>
            
            <div className="flex flex-col md:flex-row justify-between mt-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4 md:mb-0">
                <div className="flex flex-col">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Velocidad (WPM):
                  </label>
                  <select
                    className="border border-gray-300 dark:border-gray-600 rounded p-2 
                               bg-white dark:bg-gray-700 text-gray-800 dark:text-white"
                    value={wpm}
                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setWpm(Number(e.target.value))}
                  >
                    <option value="100">100</option>
                    <option value="200">200</option>
                    <option value="300">300</option>
                    <option value="400">400</option>
                    <option value="500">500</option>
                    <option value="600">600</option>
                    <option value="700">700</option>
                    <option value="800">800</option>
                  </select>
                </div>
                <div className="flex flex-col">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Palabras a la vez:
                  </label>
                  <select
                    className="border border-gray-300 dark:border-gray-600 rounded p-2 
                               bg-white dark:bg-gray-700 text-gray-800 dark:text-white"
                    value={wordsAtATime}
                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setWordsAtATime(Number(e.target.value))}
                  >
                    <option value="1">1</option>
                    <option value="2">2</option>
                    <option value="3">3</option>
                    <option value="4">4</option>
                  </select>
                </div>
                <div className="flex flex-col">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Tamaño de texto:
                  </label>
                  <select
                    className="border border-gray-300 dark:border-gray-600 rounded p-2 
                               bg-white dark:bg-gray-700 text-gray-800 dark:text-white"
                    value={fontSize}
                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFontSize(Number(e.target.value))}
                  >
                    <option value="24">Pequeño</option>
                    <option value="36">Mediano</option>
                    <option value="48">Grande</option>
                    <option value="60">Muy grande</option>
                  </select>
                </div>
              </div>
              <button
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg 
                           font-medium transition-colors duration-300 h-fit self-end"
                onClick={startReading}
                disabled={text.trim() === "" || isLoading}
              >
                {isLoading ? "Procesando..." : "Comenzar Lectura"}
              </button>
            </div>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto">
            {/* Reader interface */}
            <div className="bg-gray-900 text-white rounded-lg shadow-lg p-8 mb-6">
              <div className="flex justify-between items-center text-gray-400 text-sm mb-8">
                <div>{wpm} WPM</div>
                <div>Palabras: {wordsAtATime}</div>
                <div>Tamaño: {fontSize}px</div>
              </div>
              
              <div className="h-64 flex items-center justify-center">
                <div 
                  className="text-center"
                  style={{ fontSize: `${fontSize}px` }}
                >
                  {getColoredWord()}
                </div>
              </div>
              
              <div className="mt-4">
                <div className="w-full bg-gray-700 rounded-full h-2.5">
                  <div 
                    className="bg-blue-600 h-2.5 rounded-full transition-all duration-300" 
                    style={{ width: `${progress}%` }}
                  ></div>
                </div>
                <div className="flex justify-between mt-2 text-xs text-gray-400">
                  <div>Palabra {currentWordIndex + 1} de {words.length}</div>
                  <div>{Math.round(progress)}%</div>
                </div>
              </div>
              
              <div className="flex justify-center mt-8 space-x-4">
                <button
                  className="p-3 bg-gray-700 hover:bg-gray-600 rounded-full transition-colors"
                  onClick={resetReading}
                  title="Reiniciar"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 2v6h6"></path><path d="M3 13a9 9 0 1 0 3-7.7L3 8"></path>
                  </svg>
                </button>
                <button
                  className="p-3 bg-gray-700 hover:bg-gray-600 rounded-full transition-colors"
                  onClick={() => setCurrentWordIndex(Math.max(0, currentWordIndex - 10))}
                  title="Retroceder 10 palabras"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="19 20 9 12 19 4 19 20"></polygon><line x1="5" y1="19" x2="5" y2="5"></line>
                  </svg>
                </button>
                <button
                  className="p-3 bg-blue-600 hover:bg-blue-500 rounded-full transition-colors"
                  onClick={isReading ? pauseReading : startReading}
                  title={isReading ? "Pausar" : "Reproducir"}
                >
                  {isReading ? (
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect>
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="5 3 19 12 5 21 5 3"></polygon>
                    </svg>
                  )}
                </button>
                <button
                  className="p-3 bg-gray-700 hover:bg-gray-600 rounded-full transition-colors"
                  onClick={() => setCurrentWordIndex(Math.min(words.length - 1, currentWordIndex + 10))}
                  title="Avanzar 10 palabras"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="5 4 15 12 5 20 5 4"></polygon><line x1="19" y1="5" x2="19" y2="19"></line>
                  </svg>
                </button>
                <button
                  className="p-3 bg-gray-700 hover:bg-gray-600 rounded-full transition-colors"
                  onClick={showInputArea}
                  title="Volver a pantalla de entrada"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="9" x2="15" y2="15"></line><line x1="15" y1="9" x2="9" y2="15"></line>
                  </svg>
                </button>
              </div>
            </div>
            
            <div className="flex justify-center space-x-4">
              <button
                className="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 
                           text-gray-800 dark:text-white rounded-lg transition-colors"
                onClick={() => setWpm(Math.max(100, wpm - 50))}
              >
                - Velocidad
              </button>
              <button
                className="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 
                           text-gray-800 dark:text-white rounded-lg transition-colors"
                onClick={() => setWpm(Math.min(1000, wpm + 50))}
              >
                + Velocidad
              </button>
            </div>
          </div>
        )}
      </main>

      <footer className="bg-white dark:bg-gray-800 py-4 border-t border-gray-200 dark:border-gray-700">
        <div className="container mx-auto px-4 text-center text-gray-600 dark:text-gray-400">
          <p>RocketReader 🚀 - Aplicación para lectura rápida</p>
        </div>
      </footer>
    </div>
  );
}
