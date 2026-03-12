/**
         * --- Architecture: Extensible Analysis System with Robust Data Layer ---
         */
        
        class DebugTracker {
            constructor() {
                this.reset();
            }
            
            reset() {
                this.logs = [];
                this.rawSymbol = "Unknown";
                this.assetType = "Unknown";
                this.providerUsed = "None";
                this.fallbackAttempts = [];
                this.priceDataLoaded = false;
                this.historicalDataLoaded = false;
                this.previousCloseLoaded = false;
                this.maAnalysisSucceeded = false;
            }
            
            logAttempt(providerName, result, details = {}) {
                this.fallbackAttempts.push({
                    provider: providerName,
                    success: result,
                    mappedSymbol: details.mappedSymbol || "N/A",
                    priceUrl: details.priceUrl || "N/A",
                    historicalUrl: details.historicalUrl || "N/A",
                    priceSuccess: details.priceSuccess || false,
                    historicalSuccess: details.historicalSuccess || false,
                    error: details.error || "",
                    rawClosingPrices: details.rawClosingPrices || null
                });
            }
            
            generateReport() {
                let report = `Raw Input: ${this.rawSymbol}\n`;
                report += `Detected Asset Type: ${this.assetType}\n`;
                report += `Final Provider: ${this.providerUsed}\n\n`;
                
                report += `--- Provider Attempts ---\n`;
                this.fallbackAttempts.forEach((attempt, i) => {
                    const status = attempt.success ? "✅ SUCCESS" : "❌ FAILED";
                    report += `${i+1}. ${attempt.provider}: ${status}\n`;
                    report += `   Mapped Symbol/ID: ${attempt.mappedSymbol}\n`;
                    report += `   Price URL: ${attempt.priceUrl}\n`;
                    report += `   Price Succeeded: ${attempt.priceSuccess ? "Yes" : "No"}\n`;
                    report += `   History URL: ${attempt.historicalUrl}\n`;
                    report += `   History Succeeded: ${attempt.historicalSuccess ? "Yes" : "No"}\n`;
                    if (attempt.error) report += `   Raw Error: ${attempt.error}\n`;
                    report += `\n`;
                });
                
                report += `--- Data Status ---\n`;
                
                // Ensure variables exist 
                const hasPrice = this.priceDataLoaded ? "✅ Loaded" : "❌ Missing";
                const hasPrevClose = this.previousCloseLoaded ? "✅ Loaded" : "❌ Missing";
                const hasHistory = this.historicalDataLoaded ? "✅ Loaded" : "❌ Missing";
                const hasMA = this.maAnalysisSucceeded ? "✅ Yes" : "❌ No";
                
                report += `Price Loaded: ${hasPrice}\n`;
                report += `Previous Close Loaded: ${hasPrevClose}\n`;
                report += `Historical Loaded: ${hasHistory}\n`;
                report += `MA Complete: ${hasMA}\n`;
                
                return report;
            }
        }
        
        const debugTracker = new DebugTracker();

        class AnalysisEngine {
            constructor() {
                this.providers = [];
                this.evaluators = [];
            }

            registerProvider(provider) {
                this.providers.push(provider);
            }

            registerEvaluator(evaluator) {
                this.evaluators.push(evaluator);
            }

            async analyze(symbol, maPeriod) {
                debugTracker.reset();
                let rawData = null;
                let lastError = null;
                
                const normalizedSymbol = symbol.trim().toUpperCase()
                    .replace(/USDT$/, '')
                    .replace(/USD$/, '');

                debugTracker.rawSymbol = symbol;

                let totalChecked = 0;

                for (const provider of this.providers) {
                    if (provider.canHandle(normalizedSymbol)) {
                        totalChecked++;
                        const providerName = provider.constructor.name;
                        // Setup trackers for the internal provider pass/fail states
                        let debugState = {
                            mappedSymbol: normalizedSymbol,
                            priceUrl: "N/A",
                            historicalUrl: "N/A",
                            priceSuccess: false,
                            historicalSuccess: false,
                            error: null
                        };
                        
                        try {
                            console.log(`Trying ${providerName} for ${normalizedSymbol}...`);
                            
                            // Let the provider directly mutate the debugState object so we can see inside it
                            rawData = await provider.fetchData(normalizedSymbol, maPeriod, debugState);
                            
                            // Validate output
                            if (!rawData || typeof rawData.price !== 'number' || isNaN(rawData.price)) {
                                throw new Error("Provider returned invalid or NaN price data.");
                            }
                            
                            debugTracker.logAttempt(providerName, true, debugState);
                            debugTracker.providerUsed = providerName;
                            debugTracker.assetType = provider.assetType || "Unknown";
                            debugTracker.priceDataLoaded = true;
                            
                            // previousClose applies to stocks
                            if (rawData.changeLabel === "Daily Change" && rawData.changeValue !== null && !isNaN(rawData.changeValue)) {
                                debugTracker.previousCloseLoaded = true;
                            } else if (rawData.changeLabel !== "Daily Change") {
                                // Default true for crypto since they don't use 'previousClose' 
                                debugTracker.previousCloseLoaded = true; 
                            }
                            
                            if (rawData.maValue !== null && typeof rawData.maValue === 'number' && !isNaN(rawData.maValue)) {
                                debugTracker.historicalDataLoaded = true;
                            }
                            
                            break; 
                        } catch (err) {
                            console.warn(`${providerName} failed for ${normalizedSymbol}: ${err.message}`);
                            debugState.error = err.message;
                            debugTracker.logAttempt(providerName, false, debugState);
                            lastError = err.message;
                        }
                    }
                }

                if (!rawData) {
                    if (totalChecked === 0) {
                        throw new Error(`Asset data unavailable. Symbol '${normalizedSymbol}' is not supported.`);
                    } else if (lastError) {
                         // Pass back a clear error if they all failed
                         throw new Error(`Asset data unavailable. Last fallback error: ${lastError}`);
                    } else {
                         throw new Error("Asset data unavailable.");
                    }
                }

                let evaluationResult = {};
                for (const evaluator of this.evaluators) {
                    const result = evaluator.evaluate(rawData);
                    evaluationResult = { ...evaluationResult, ...result };
                }

                debugTracker.maAnalysisSucceeded = evaluationResult.hasEnoughData || false;

                return { ...rawData, ...evaluationResult };
            }
        }

        // --- Utility ---
        function calculateTechnicalIndicators(prices, period) {
            // Check that we actually have enough historical prices for MA
            if (!prices || prices.length <= period) {
                return { current: null, previous: null, atr: null, insufficientHistory: true };
            }
            
            // For ATR we need High/Low/Close objects, for MA we just need prices array or close properties
            const isCandleObjects = prices[0] !== null && typeof prices[0] === 'object' && 'close' in prices[0];
            
            const validCandles = isCandleObjects 
                ? prices.filter(c => c && typeof c.close === 'number' && !isNaN(c.close))
                : prices.filter(p => p !== null && !isNaN(p)).map(p => ({ close: p }));

            if (validCandles.length <= period) return { current: null, previous: null, atr: null, insufficientHistory: true };

            const closes = validCandles.map(c => c.close);
            
            // Calculate MA
            const currentSubset = closes.slice(-period);
            const sum = currentSubset.reduce((acc, val) => acc + val, 0);
            const currentMA = sum / period;

            let previousMA = null;
            const prevSubset = closes.slice(-(period + 1), -1);
            if (prevSubset.length === period) {
                const prevSum = prevSubset.reduce((acc, val) => acc + val, 0);
                previousMA = prevSum / period;
            }

            // Calculate ATR(14) - Do not fail MA if this fails
            let atr = null;
            if (isCandleObjects && validCandles.length >= 15) {
                atr = calculateATR(validCandles, 14);
            }

            return { current: currentMA, previous: previousMA, atr: atr, insufficientHistory: false };
        }

        function calculateATR(candles, period = 14) {
            let trueRanges = [];
            // Start from index 1 to have previous close
            for (let i = 1; i < candles.length; i++) {
                const high = candles[i].high;
                const low = candles[i].low;
                const prevClose = candles[i-1].close;
                
                if (high !== undefined && low !== undefined && prevClose !== undefined) {
                    const tr1 = high - low;
                    const tr2 = Math.abs(high - prevClose);
                    const tr3 = Math.abs(low - prevClose);
                    trueRanges.push(Math.max(tr1, tr2, tr3));
                }
            }
            
            if (trueRanges.length >= period) {
                const atrSubset = trueRanges.slice(-period);
                const atrSum = atrSubset.reduce((a, b) => a + b, 0);
                return atrSum / period;
            }
            return null;
        }

        // --- Data Providers ---

        class CoinGeckoProvider {
            constructor() {
                this.assetType = "Crypto";
                // Enforce STRICT EXACT mappings. 
                // Do not use fuzzy matching for these mapped symbols.
                this.symbolMap = {
                    'BTC': 'bitcoin', 
                    'ETH': 'ethereum', 
                    'SOL': 'solana',
                    'SUI': 'sui', 
                    'TAO': 'bittensor'
                };
            }

            canHandle(symbol) {
                return !!this.symbolMap[symbol];
            }

            async fetchData(symbol, maPeriod, debugState) {
                const cgId = this.symbolMap[symbol];
                debugState.mappedSymbol = cgId || "Not found in map";
                
                // Extra check since we should not hit this if canHandle is true,
                // but if we do, fail explicitly to match the prompt requirement.
                if (!cgId) throw new Error("Mapped crypto asset unavailable");

                const priceUrl = `https://api.coingecko.com/api/v3/simple/price?ids=${cgId}&vs_currencies=usd&include_24hr_change=true`;
                debugState.priceUrl = priceUrl;

                const simpleRes = await fetch(priceUrl);
                if (!simpleRes.ok) throw new Error(`CoinGecko HTTP Error: ${simpleRes.status}`);
                
                const simpleData = await simpleRes.json();
                if (!simpleData[cgId]) throw new Error("Mapped crypto asset unavailable");

                const currentPrice = simpleData[cgId].usd;
                let change24h = simpleData[cgId].usd_24h_change;
                debugState.priceSuccess = true;
                
                if (currentPrice === undefined || currentPrice === null || isNaN(currentPrice)) {
                     throw new Error("CoinGecko returned invalid price.");
                }
                
                // Validate change, don't let NaNs slip through
                if (change24h === null || isNaN(change24h)) change24h = null;

                let historySymbol = symbol;
                if (!historySymbol.endsWith("USDT")) {
                    historySymbol += "USDT";
                }
                
                // Route CoinGecko historical requests to Binance klines since CoinGecko chart endpoints are natively volatile/unreliable without paid keys
                const limit = Math.max(maPeriod + 14, 150);
                const historyUrl = `https://api.binance.com/api/v3/klines?symbol=${historySymbol}&interval=1d&limit=${limit}`;
                debugState.historicalUrl = historyUrl;
                
                async function fetchHistoryWithRetry(url, retries = 1) {
                    for (let i = 0; i <= retries; i++) {
                        try {
                            const res = await fetch(url);
                            if (res.ok) {
                                return await res.json();
                            }
                        } catch(e) { }
                    }
                    throw new Error(`History endpoint failed after retries`);
                }
                
                let maData = { current: null, previous: null, atr: null, insufficientHistory: false };
                
                try {
                    const klinesData = await fetchHistoryWithRetry(historyUrl);
                    if (klinesData && klinesData.length > 0) {
                        const rawCloses = klinesData.map(k => typeof k[4] !== 'undefined' ? parseFloat(k[4]) : null);
                        const candles = klinesData.map(k => ({
                            high: typeof k[2] !== 'undefined' ? parseFloat(k[2]) : undefined,
                            low: typeof k[3] !== 'undefined' ? parseFloat(k[3]) : undefined,
                            close: typeof k[4] !== 'undefined' ? parseFloat(k[4]) : null
                        }));
                        maData = calculateTechnicalIndicators(candles, maPeriod);
                        // Save the full raw array to debugState for backtesting later
                        debugState.rawClosingPrices = rawCloses; 
                        debugState.historicalSuccess = true;
                    } else {
                        maData.insufficientHistory = true;
                    }
                } catch (err) {
                    console.warn(`Historical data fetch failed on CoinGecko: ${err.message}`);
                    maData.insufficientHistory = true;
                }

                return {
                    symbol: symbol,
                    price: currentPrice,
                    changeValue: change24h,
                    changeLabel: "24h Change",
                    maValue: maData.current,
                    maPreviousValue: maData.previous,
                    insufficientHistory: maData.insufficientHistory,
                    maPeriod: maPeriod,
                    lastUpdated: new Date()
                };
            }
        }

        class BinanceProvider {
            constructor() {
                this.assetType = "Crypto";
            }

            canHandle(symbol) {
                // Trust Binance as fallback
                return symbol.length >= 2 && symbol.length <= 6 && !symbol.includes('^'); 
            }

            async fetchData(symbol, maPeriod, debugState) {
                let pair = symbol + 'USDT';
                debugState.mappedSymbol = pair;

                const priceUrl = `https://api.binance.com/api/v3/ticker/24hr?symbol=${pair}`;
                debugState.priceUrl = priceUrl;

                const tickerRes = await fetch(priceUrl);
                if (!tickerRes.ok) {
                    if (tickerRes.status === 400 || tickerRes.status === 404) {
                        throw new Error(`Symbol '${pair}' not supported by Binance.`);
                    }
                    throw new Error(`Binance HTTP Error: ${tickerRes.status}`);
                }
                const data = await tickerRes.json();
                
                let currentPrice = parseFloat(data.lastPrice);
                let change24h = parseFloat(data.priceChangePercent);
                
                if (isNaN(currentPrice)) throw new Error("Binance returned NaN price.");
                debugState.priceSuccess = true;

                if (isNaN(change24h)) change24h = null;
                
                let maData = { current: null, previous: null, insufficientHistory: false };
                
                let historySymbol = pair;
                // Double check to ensure USDT is appended properly specifically for history
                if (!historySymbol.endsWith("USDT")) {
                     historySymbol = symbol + "USDT";
                }
                
                const limit = Math.max(maPeriod + 14, 150);
                const historyUrl = `https://api.binance.com/api/v3/klines?symbol=${historySymbol}&interval=1d&limit=${limit}`;
                debugState.historicalUrl = historyUrl;
                
                async function fetchBinanceHistoryWithRetry(url, retries = 1) {
                    for (let i = 0; i <= retries; i++) {
                        try {
                            const res = await fetch(url);
                            if (res.ok) {
                                return await res.json();
                            }
                        } catch(e) { }
                    }
                    throw new Error(`History endpoint failed after retries`);
                }
                
                try {
                    const klinesData = await fetchBinanceHistoryWithRetry(historyUrl);
                    if (klinesData && klinesData.length > 0) {
                        const rawCloses = klinesData.map(k => typeof k[4] !== 'undefined' ? parseFloat(k[4]) : null);
                        const candles = klinesData.map(k => ({
                            high: typeof k[2] !== 'undefined' ? parseFloat(k[2]) : undefined,
                            low: typeof k[3] !== 'undefined' ? parseFloat(k[3]) : undefined,
                            close: typeof k[4] !== 'undefined' ? parseFloat(k[4]) : null
                        }));
                        maData = calculateTechnicalIndicators(candles, maPeriod);
                        // Save the full raw array to debugState for backtesting later
                        debugState.rawClosingPrices = rawCloses; 
                        debugState.historicalSuccess = true;
                    } else {
                        maData.insufficientHistory = true;
                    }
                } catch (err) {
                    console.warn(`Historical data fetch failed on Binance: ${err.message}`);
                    maData.insufficientHistory = true;
                }

                return {
                    symbol: symbol,
                    price: currentPrice,
                    changeValue: change24h,
                    changeLabel: "24h Change",
                    maValue: maData.current,
                    maPreviousValue: maData.previous,
                    atrValue: maData.atr,
                    insufficientHistory: maData.insufficientHistory,
                    maPeriod: maPeriod,
                    lastUpdated: new Date()
                };
            }
        }

        class YahooProvider {
            constructor() {
                this.assetType = "Stock / ETF";
            }
            
            canHandle(symbol) { 
                 // Simple bounds check for standard stock tickers
                return symbol.length >= 1 && symbol.length <= 6; 
            }

            async fetchData(symbol, maPeriod, debugState) {
                // Yahoo finance uses the exact symbol (mostly)
                debugState.mappedSymbol = symbol;

                let range = '1y'; 
                if (maPeriod + 14 > 250) range = '2y'; // Adjust range for ATR
                if (maPeriod + 14 > 500) range = '5y';
                
                const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=${range}`;
                
                debugState.priceUrl = "(combo URL via proxy)";
                debugState.historicalUrl = url;
                
                // Directly use Yahoo Finance instead of allorigins proxy to avoid CORS proxy failure blocks. 
                // Many proxies block or cache Yahoo aggressively. However, to bypass browser CORS if direct fails:
                // We'll use a more reliable proxy structure for fetching stock data if necessary.
                // Using 'corsproxy.io' as it routinely works well for Yahoo Finance without caching issues.
                // We'll bypass the corsproxy wrapper entirely to prevent network failures.
                const proxyUrl = `https://cors-anywhere.herokuapp.com/${url}`;
                debugState.priceUrl = proxyUrl;

                let response;
                try {
                    response = await fetch(proxyUrl);
                } catch (e) {
                    throw new Error(`Network failure attempting to fetch from Yahoo Finance proxy.`);
                }

                if (!response.ok) throw new Error(`Yahoo fetch failed: HTTP ${response.status}`);
                
                let data;
                try {
                    data = await response.json();
                } catch (e) {
                    throw new Error(`Yahoo proxy returned invalid json.`);
                }
                
                if (!data.chart || data.chart.error) {
                     // Check if it's NVDA specifically or just fail normally
                     throw new Error(`Stock provider failed for ${symbol}`);
                }
                if (!data.chart.result || data.chart.result.length === 0) {
                    throw new Error(`Historical stock data unavailable for ${symbol}`);
                }
                
                debugState.historicalSuccess = true;
                debugState.priceSuccess = true;
                
                const result = data.chart.result[0];
                const meta = result.meta;
                
                const currentPrice = meta.regularMarketPrice;
                const previousClose = meta.previousClose;
                
                if (currentPrice === undefined || currentPrice === null || isNaN(currentPrice)) {
                    throw new Error("Yahoo Finance missing valid regularMarketPrice.");
                }

                // Explicit Stock Daily Change - absolutely protecting against NaN
                let changePercent = null;
                if (previousClose !== undefined && previousClose !== null && !isNaN(previousClose) && previousClose > 0) {
                     changePercent = ((currentPrice - previousClose) / previousClose) * 100;
                }
                
                // Set the specific change label
                const currentChangeLabel = "Daily Change";
                
                let maData = { current: null, previous: null, atr: null, insufficientHistory: false };
                
                if (result.indicators && result.indicators.quote && result.indicators.quote[0].close) {
                    const closePrices = result.indicators.quote[0].close;
                    const highPrices = result.indicators.quote[0].high || [];
                    const lowPrices = result.indicators.quote[0].low || [];
                    
                    let candles = [];
                    for (let i = 0; i < closePrices.length; i++) {
                        candles.push({
                            high: typeof highPrices[i] === 'number' ? highPrices[i] : undefined,
                            low: typeof lowPrices[i] === 'number' ? lowPrices[i] : undefined,
                            close: typeof closePrices[i] === 'number' ? closePrices[i] : null
                        });
                    }
                    
                    maData = calculateTechnicalIndicators(candles, maPeriod);
                    // Save the full raw block to debugState for backtesting later
                    debugState.rawClosingPrices = closePrices.map(p => typeof p === 'number' ? p : null);
                } else {
                    maData.insufficientHistory = true;
                }
                
                return {
                    symbol: symbol,
                    price: currentPrice,
                    changeValue: changePercent,
                    changeLabel: currentChangeLabel, // Force Stock Daily Change Label
                    maValue: maData.current,
                    maPreviousValue: maData.previous,
                    atrValue: maData.atr,
                    insufficientHistory: maData.insufficientHistory,
                    maPeriod: maPeriod,
                    lastUpdated: new Date(meta.regularMarketTime * 1000 || Date.now())
                };
            }
        }

        class AlphaVantageFallbackProvider {
            constructor() {
                 this.assetType = "Stock / ETF";
            }
            canHandle(symbol) { return true; }
            
            async fetchData(symbol, maPeriod, debugState) {
                debugState.priceUrl = "AlphaVantage Fallback / Not Configured";
                debugState.historicalUrl = "AlphaVantage Fallback / Not Configured";
                // Ensure the final fallback clearly echoes the inability to find the asset
                throw new Error("Asset data unavailable. AlphaVantage fallback reached but requires backend API key configuration.");
            }
        }

        // --- Modular Math & Evaluation Functions ---
        // Ensuring these explicitly exist per requirements
        
        async function fetchAssetData(symbol, maPeriod, engineInst) {
            return await engineInst.analyze(symbol, maPeriod);
        }

        function calculateMovingAverage(prices, period) {
            // Already delegated to existing calculateTechnicalIndicators but wrapping for modularity
            return calculateTechnicalIndicators(prices, period);
        }

        function calculateSlope(currentMA, previousMA) {
            if (currentMA === null || previousMA === null || previousMA === 0) return { isPositive: null, slopePct: 0 };
            const slopePct = Math.abs((currentMA - previousMA) / previousMA) * 100;
            return {
                isPositive: currentMA > previousMA,
                slopePct: slopePct
            };
        }

        function slopeIsPositive(value) {
          if (value === undefined || value === null) return false;
          return value > 0;
        }

        function evaluateTrend(price, currentMA, atrValue = null) {
            const regime = price >= currentMA ? "Bullish" : "Bearish";
            const direction = regime === "Bullish" ? "Long" : "Short";
            const leverage = regime === "Bullish" ? "2.25x" : "1.0x";
            
            let alignmentScore = 0;
            if (regime === "Bullish") {
                alignmentScore = slopeIsPositive ? 40 : 20;
            } else {
                alignmentScore = (!slopeIsPositive) ? 40 : 20;
            }
            
            if (currentMA === null) return { distancePercent: 0, atrDistance: null, regime, direction, leverage, alignmentScore };
            const distancePercent = ((price - currentMA) / currentMA) * 100;
            
            let atrDistance = null;
            if (atrValue !== null && atrValue > 0) {
                 atrDistance = Number(((price - currentMA) / atrValue).toFixed(2));
            }
            
            return {
                distancePercent: distancePercent,
                atrDistance: atrDistance,
                regime, direction, leverage, alignmentScore
            };
        }

        function calculateOpportunityScore(alignmentScore, distancePercent, slopePct) {
            let bScore = 0;
            const dist = Math.abs(distancePercent);
            
            if (dist <= 5) bScore = 30;
            else if (dist > 5 && dist <= 10) bScore = 20;
            else if (dist > 10 && dist <= 20) bScore = 10;
            else bScore = 0;
            
            let cScore = 0;
            if (slopePct > 0.5) cScore = 30;        // Strong
            else if (slopePct > 0.2) cScore = 20;   // Moderate
            else if (slopePct > 0.05) cScore = 10;  // Weak
            else cScore = 0;                        // Flat
            
            return alignmentScore + bScore + cScore;
        }

        // --- Opportunity Evaluator ---
        class TrendFollowingEvaluator {
            evaluate(data) {
                if (data.insufficientHistory || data.maValue === null || isNaN(data.maValue)) {
                    return {
                        hasEnoughData: false,
                        slopeIsPositive: null,
                        distancePercent: null,
                        atrDistance: null,
                        score: null, 
                        status: "Insufficient history for MA calculation",
                        statusClass: "badge-neutral",
                        explanation: `Historical data is insufficient for this asset to complete the MA(${data.maPeriod}) analysis safely.`,
                        regime: "N/A",
                        direction: "N/A",
                        leverage: "N/A",
                        atrValue: data.atrValue || null
                    };
                }

                const price = data.price;
                const ma = data.maValue;
                const prevMa = data.maPreviousValue;

                const slopeData = calculateSlope(ma, prevMa);
                const trendData = evaluateTrend(price, ma, data.atrValue);
                
                const distancePercent = trendData.distancePercent;
                const atrDistance = trendData.atrDistance;
                const regime = trendData.regime;
                const direction = trendData.direction;
                const leverage = trendData.leverage;
                const alignmentScore = trendData.alignmentScore;

                if (isNaN(distancePercent) || !isFinite(distancePercent)) {
                    return { hasEnoughData: false, status: "Calculation error", explanation: "Data is mathematically malformed (NaN detected)." };
                }

                const score = calculateOpportunityScore(alignmentScore, distancePercent, slopeData.slopePct);

                let status = "";
                let statusClass = "";
                let explanation = "";

                if (regime === "Bullish") {
                    explanation = "The asset is trading above its trend average, so the current strategy regime is bullish. This would favor a long position.";
                    if (distancePercent >= 0 && distancePercent <= 5) {
                        status = "Potential long pullback opportunity";
                        statusClass = "badge-pullback-long";
                    } else {
                        status = "Extended above trend";
                        statusClass = "badge-extended-long";
                    }
                } else {
                    explanation = "The asset is trading below its trend average, so the current strategy regime is bearish. This would favor a short position.";
                    if (distancePercent < 0 && distancePercent >= -5) {
                        status = "Potential short pullback opportunity";
                        statusClass = "badge-pullback-short";
                    } else {
                        status = "Extended below trend";
                        statusClass = "badge-extended-short";
                    }
                }

                return {
                    hasEnoughData: true,
                    slopeIsPositive: slopeData.isPositive,
                    distancePercent,
                    atrDistance,
                    score,
                    status,
                    statusClass,
                    explanation,
                    regime: regime,
                    direction: direction,
                    leverage: leverage,
                    atrValue: data.atrValue || null
                };
            }
        }

        // --- MA Comparison Backtester --- //
        class MovingAverageBacktester {
            constructor() {
                this.periodsToTest = [50, 75, 100, 125, 150, 200];
            }
            
            runBasicBacktest(prices, maPeriod) {
                if (!prices || prices.length < maPeriod + 2) return null;
                
                const validPrices = prices.filter(p => p !== null && !isNaN(p));
                if (validPrices.length < maPeriod + 2) return null;

                let strategyCapital = 1000;
                let holdCapital = 1000;
                
                let currentPosition = 0; // 0 = flat, 1 = long, -1 = short
                let entryPrice = 0;
                let flips = 0;
                
                let peakCapital = strategyCapital;
                let maxDrawdown = 0;

                const startIdx = maPeriod;
                const buyAndHoldStartPrice = validPrices[startIdx];
                const finalPrice = validPrices[validPrices.length - 1];

                for (let i = startIdx; i < validPrices.length; i++) {
                    const todayPrice = validPrices[i];
                    
                    // Calc current MA for today using prior `maPeriod` days
                    const subRange = validPrices.slice(i - maPeriod, i);
                    const sum = subRange.reduce((a, b) => a + b, 0);
                    const ma = sum / maPeriod;

                    // Execute trades from previous day's signal (simple assumed closing cross)
                    if (currentPosition === 1 && todayPrice < ma) {
                        // Close Long, Open Short
                        const returnPct = (todayPrice - entryPrice) / entryPrice;
                        strategyCapital = strategyCapital * (1 + returnPct);
                        currentPosition = -1;
                        entryPrice = todayPrice;
                        flips++;
                    } else if (currentPosition === -1 && todayPrice > ma) {
                        // Close Short, Open Long
                        const returnPct = (entryPrice - todayPrice) / entryPrice;
                        strategyCapital = strategyCapital * (1 + returnPct);
                        currentPosition = 1;
                        entryPrice = todayPrice;
                        flips++;
                    } else if (currentPosition === 0) {
                        // Initial trade
                        currentPosition = todayPrice > ma ? 1 : -1;
                        entryPrice = todayPrice;
                    }
                    
                    // Track Drawdown end-of-day theoretical
                    let currentTheorCapital = strategyCapital;
                    if (currentPosition === 1) {
                         currentTheorCapital = strategyCapital * (1 + ((todayPrice - entryPrice) / entryPrice));
                    } else if (currentPosition === -1) {
                         currentTheorCapital = strategyCapital * (1 + ((entryPrice - todayPrice) / entryPrice));
                    }
                    
                    if (currentTheorCapital > peakCapital) peakCapital = currentTheorCapital;
                    const dd = (peakCapital - currentTheorCapital) / peakCapital * 100;
                    if (dd > maxDrawdown) maxDrawdown = dd;
                }

                // Close out open position at very end
                if (currentPosition === 1) {
                    const returnPct = (finalPrice - entryPrice) / entryPrice;
                    strategyCapital = strategyCapital * (1 + returnPct);
                } else if (currentPosition === -1) {
                    const returnPct = (entryPrice - finalPrice) / entryPrice;
                    strategyCapital = strategyCapital * (1 + returnPct);
                }

                const holdReturnPct = ((finalPrice - buyAndHoldStartPrice) / buyAndHoldStartPrice) * 100;
                const stratReturnPct = ((strategyCapital - 1000) / 1000) * 100;

                return {
                    maPeriod: maPeriod,
                    stratReturnPct: stratReturnPct,
                    holdReturnPct: holdReturnPct,
                    maxDrawdown: maxDrawdown,
                    flips: flips,
                    rankingScore: 0 // calculated later against peers
                };
            }

            evaluateAll(rawPrices) {
                let results = [];
                let maxStratReturn = -Infinity;
                let minDrawdown = Infinity;
                let minFlips = Infinity;
                
                // Collect valid backtests
                for (let p of this.periodsToTest) {
                    const res = this.runBasicBacktest(rawPrices, p);
                    if (res) {
                        results.push(res);
                        if (res.stratReturnPct > maxStratReturn) maxStratReturn = res.stratReturnPct;
                        if (res.maxDrawdown < minDrawdown) minDrawdown = res.maxDrawdown;
                        if (res.flips < minFlips) minFlips = res.flips;
                    }
                }
                
                if (results.length === 0) return { bestMa: null, results: [] };

                // Calculate balanced ranking score
                let bestScore = -Infinity;
                let bestMa = null;

                for (let r of results) {
                    // Normalize inputs (rough heuristic weighting: Return=50%, DD=30%, Flips=20%)
                    let score = 0;
                    
                    if (maxStratReturn > 0) score += (r.stratReturnPct / maxStratReturn) * 50; 
                    else score += r.stratReturnPct; // punish negatives
                    
                    // Lower DD is better
                    if (r.maxDrawdown > 0) score += ((minDrawdown / r.maxDrawdown) * 30);
                    else score += 30; // 0 drawdown
                    
                    // Fewer flips is better
                    if (r.flips > 0) score += ((minFlips / r.flips) * 20);
                    else score += 20;

                    r.rankingScore = score;
                    
                    if (score > bestScore) {
                        bestScore = score;
                        bestMa = r.maPeriod;
                    }
                }

                return { bestMa, results };
            }
        }
        
        const maBacktester = new MovingAverageBacktester();

        // --- Initialization ---
        const engine = new AnalysisEngine();
        
        engine.registerProvider(new CoinGeckoProvider()); 
        engine.registerProvider(new BinanceProvider());   
        
        engine.registerProvider(new YahooProvider());     
        engine.registerProvider(new AlphaVantageFallbackProvider()); 
        
        engine.registerEvaluator(new TrendFollowingEvaluator());

        // --- UI Interactions ---
        const symbolInput = document.getElementById('symbol-input');
        const maInput = document.getElementById('ma-input');
        const analyzeBtn = document.getElementById('analyze-btn');
        const resultsPanel = document.getElementById('results-panel');
        
        // Debug components
        const debugPanel = document.getElementById('debug-panel');
        const debugToggle = document.getElementById('debug-toggle');
        const debugContent = document.getElementById('debug-content');

        debugToggle.addEventListener('click', () => {
            debugPanel.classList.toggle('open');
        });

        maInput.addEventListener('input', function() {
            this.value = this.value.replace(/[^0-9]/g, '');
        });
        
        maInput.addEventListener('blur', function() {
            let val = parseInt(this.value, 10);
            if (isNaN(val) || val <= 0) {
                this.value = '125';
            }
        });

        async function performAnalysis() {
            hideMessage();
            const symbol = symbolInput.value.trim();
            if (!symbol) {
                showMessage("Please enter a symbol.", "error");
                return;
            }
            
            let maPeriod = parseInt(maInput.value, 10);
            if (isNaN(maPeriod) || maPeriod <= 0) maPeriod = 125;

            analyzeBtn.disabled = true;
            analyzeBtn.textContent = "Analyzing...";
            resultsPanel.classList.remove('visible');

            showMessage("Fetching market data...", "info");

            try {
                const data = await engine.analyze(symbol, maPeriod);
                renderResults(data);
                
                debugContent.textContent = debugTracker.generateReport();
                
                if (data.price !== null && data.insufficientHistory) {
                     showMessage("Historical data unavailable, so MA analysis could not be completed.", "warning");
                } else if (data.price !== null && data.changeValue === null) {
                     showMessage("Price data loaded, but change data unavailable.", "warning");
                } else {
                     hideMessage(); 
                }
                
            } catch (error) {
                // If it's one of the explicitly requested error messages, show it verbatim
                const explicitErrors = [
                    "Mapped crypto asset unavailable", 
                    "Stock provider failed for NVDA", 
                    "Historical stock data unavailable for NVDA"
                ];
                
                let showMsg = error.message;
                
                if (explicitErrors.includes(error.message) || error.message.startsWith("Stock provider failed") || error.message.startsWith("Historical stock data unavailable")) {
                    showMsg = error.message;
                } else {
                     showMsg = error.message.includes("data unavailable") || error.message.includes("not found") 
                        ? "Asset data unavailable" 
                        : error.message;
                }

                showMessage(showMsg, "error");
                
                debugContent.textContent = debugTracker.generateReport();
                resultsPanel.classList.add('visible'); 
                
                renderBlankResults(symbol); 
                
            } finally {
                analyzeBtn.disabled = false;
                analyzeBtn.textContent = "Analyze Opportunity";
            }
        }

        function formatCurrency(value) {
            if (value === null || isNaN(value)) return "N/A";
            return new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: 'USD',
                minimumFractionDigits: 2,
                maximumFractionDigits: value < 1 ? 4 : 2
            }).format(value);
        }

        function showMessage(msg, type) {
            const el = document.getElementById('status-message');
            el.textContent = msg;
            
            el.className = 'status-message visible';
            
            if (type === "error") {
                el.classList.add('error-message');
            } else if (type === "info") {
                 el.classList.add('info-message');
            } else if (type === "warning") {
                 el.classList.add('info-message'); 
                 el.style.borderColor = "var(--warning)";
                 el.style.color = "var(--warning)";
            }
        }
        
        function hideMessage() {
            const el = document.getElementById('status-message');
            el.className = 'status-message'; 
        }

        function renderBlankResults(symbol) {
            document.getElementById('res-symbol').textContent = symbol.toUpperCase();
            document.getElementById('res-price').textContent = "---";
            
            document.getElementById('res-change-label').textContent = "Change";
            const elChange = document.getElementById('res-change');
            elChange.textContent = "Data unavailable";
            elChange.className = "result-value data-missing";

            document.getElementById('res-ma-label').textContent = `MA`;
            document.getElementById('res-ma-value').textContent = "N/A";
            document.getElementById('res-ma-value').className = "result-value data-missing";
            
            document.getElementById('res-ma-slope').textContent = "N/A";
            document.getElementById('res-ma-slope').className = "result-value data-missing";
            
            document.getElementById('res-dist-label').textContent = "Distance from MA";
            document.getElementById('res-dist-value').textContent = "N/A";
            document.getElementById('res-dist-value').className = "result-value data-missing";
            document.getElementById('res-trend-signal').textContent = "";

            document.getElementById('res-atr-value').textContent = "N/A";
            document.getElementById('res-atr-value').className = "result-value data-missing";
            document.getElementById('res-atr-dist').textContent = "N/A";
            document.getElementById('res-atr-dist').className = "result-value data-missing";

            document.getElementById('res-regime').textContent = "N/A";
            document.getElementById('res-regime').className = "result-value data-missing";
            document.getElementById('res-direction').textContent = "N/A";
            document.getElementById('res-direction').className = "result-value data-missing";
            document.getElementById('res-leverage').textContent = "N/A";
            document.getElementById('res-leverage').className = "result-value data-missing";

            document.getElementById('res-score').textContent = "-";
            
            document.getElementById('res-status-badge').textContent = "Analysis Failed";
            document.getElementById('res-status-badge').className = "opportunity-badge badge-neutral";
            document.getElementById('res-explanation').textContent = "Data could not be fetched for this asset. Check the root issue inside the debug panel.";
            
            document.getElementById('res-time').textContent = "";
        }

        function renderResults(data) {
            document.getElementById('res-symbol').textContent = data.symbol;
            document.getElementById('res-price').textContent = formatCurrency(data.price);

            const elChangeLabel = document.getElementById('res-change-label');
            const elChange = document.getElementById('res-change');
            
            elChangeLabel.textContent = data.changeLabel;
            
            if (data.changeValue !== null && !isNaN(data.changeValue)) {
                const isPos = data.changeValue >= 0;
                elChange.textContent = `${isPos ? "+" : ""}${data.changeValue.toFixed(2)}%`;
                elChange.className = `result-value ${isPos ? 'change-positive' : 'change-negative'}`;
            } else {
                // If the stock provider failed to produce previousClose explicitly:
                elChange.textContent = data.changeLabel === "Daily Change" 
                    ? "Daily change unavailable" 
                    : "Change unavailable";
                elChange.className = "result-value data-missing";
            }

            document.getElementById('res-ma-label').textContent = `MA(${data.maPeriod})`;
            const elMaSlope = document.getElementById('res-ma-slope');
            const elDistLabel = document.getElementById('res-dist-label');
            const elDistValue = document.getElementById('res-dist-value');
            const elTrendSignal = document.getElementById('res-trend-signal');
            
            const elAtrValue = document.getElementById('res-atr-value');
            const elAtrDist = document.getElementById('res-atr-dist');

            const elScore = document.getElementById('res-score');
            const elBadge = document.getElementById('res-status-badge');
            const elExplanation = document.getElementById('res-explanation');
            const elRegime = document.getElementById('res-regime');
            const elDirection = document.getElementById('res-direction');
            const elLeverage = document.getElementById('res-leverage');

            elDistLabel.textContent = `Distance from MA(${data.maPeriod})`;

            if (data.hasEnoughData) {
                document.getElementById('res-ma-value').textContent = formatCurrency(data.maValue);
                document.getElementById('res-ma-value').className = "result-value";
                
                if (data.slopeIsPositive !== null) {
                    elMaSlope.textContent = data.slopeIsPositive ? "Rising" : "Falling";
                    elMaSlope.className = `result-value ${data.slopeIsPositive ? 'change-positive' : 'change-negative'}`;
                } else {
                    elMaSlope.textContent = "N/A";
                    elMaSlope.className = "result-value data-missing";
                }

                if (data.distancePercent !== null && !isNaN(data.distancePercent)) {
                    const distSign = data.distancePercent > 0 ? "+" : "";
                    elDistValue.textContent = `${distSign}${data.distancePercent.toFixed(2)}%`;
                    
                    if (data.distancePercent > 0) elDistValue.className = "result-value change-positive";
                    else if (data.distancePercent < 0) elDistValue.className = "result-value change-negative";
                    else elDistValue.className = "result-value change-neutral";
                } else {
                    elDistValue.textContent = "N/A";
                    elDistValue.className = "result-value data-missing";
                }

                if (data.atrValue !== null && !isNaN(data.atrValue)) {
                    elAtrValue.textContent = formatCurrency(data.atrValue);
                    elAtrValue.className = "result-value";
                } else {
                    elAtrValue.textContent = "N/A";
                    elAtrValue.className = "result-value data-missing";
                }

                if (data.atrDistance !== null && !isNaN(data.atrDistance)) {
                    const distSign = data.atrDistance > 0 ? "+" : "";
                    elAtrDist.textContent = `${distSign}${data.atrDistance.toFixed(2)}x ATR`;
                    if (data.atrDistance > 0) elAtrDist.className = "result-value change-positive";
                    else if (data.atrDistance < 0) elAtrDist.className = "result-value change-negative";
                    else elAtrDist.className = "result-value change-neutral";
                } else {
                    elAtrDist.textContent = "N/A";
                    elAtrDist.className = "result-value data-missing";
                }

                if (data.price >= data.maValue) {
                    elTrendSignal.textContent = "Price is above trend average (Bullish Context)";
                    elTrendSignal.className = "trend-signal change-positive";
                } else {
                    elTrendSignal.textContent = "Price is below trend average (Bearish Context)";
                    elTrendSignal.className = "trend-signal change-negative";
                }

                elRegime.textContent = data.regime;
                elRegime.className = `result-value ${data.regime === 'Bullish' ? 'change-positive' : 'change-negative'}`;
                
                elDirection.textContent = data.direction;
                elDirection.className = `result-value ${data.direction === 'Long' ? 'change-positive' : 'change-negative'}`;
                
                elLeverage.textContent = data.leverage;
                elLeverage.className = "result-value";

                elScore.textContent = data.score !== null ? data.score : "-";
                
                elBadge.textContent = data.status;
                elBadge.className = `opportunity-badge ${data.statusClass}`;
                elExplanation.textContent = data.explanation;

            } else {
                document.getElementById('res-ma-value').textContent = "N/A";
                document.getElementById('res-ma-value').className = "result-value data-missing";
                elMaSlope.textContent = "N/A";
                elMaSlope.className = "result-value data-missing";
                elDistValue.textContent = "N/A";
                elDistValue.className = "result-value data-missing";
                elAtrValue.textContent = "N/A";
                elAtrValue.className = "result-value data-missing";
                elAtrDist.textContent = "N/A";
                elAtrDist.className = "result-value data-missing";
                elTrendSignal.textContent = "";
                
                elRegime.textContent = "N/A";
                elRegime.className = "result-value data-missing";
                elDirection.textContent = "N/A";
                elDirection.className = "result-value data-missing";
                elLeverage.textContent = "N/A";
                elLeverage.className = "result-value data-missing";

                elScore.textContent = "-";
                elBadge.textContent = data.status;
                elBadge.className = "opportunity-badge badge-neutral";
                elExplanation.textContent = data.explanation;
            }

            document.getElementById('res-time').textContent = `Data last updated: ${data.lastUpdated ? data.lastUpdated.toLocaleString() : 'Unknown'}`;
            document.getElementById('results-panel').classList.add('visible');

            // Hook Backtester if raw prices exist (they are saved safely in the singleton debug loop)
            const maPanel = document.getElementById('ma-comparison-panel');
            const maBody = document.getElementById('macomp-tbody');
            const elBestMa = document.getElementById('res-best-ma');
            
            maBody.innerHTML = '';
            
            // Try extracting rawPrices from the latest debugTracker payload
            let rawFallbackPrices = null;
            if (window.debugTracker && debugTracker.fallbackAttempts) {
                const successfulAttempt = debugTracker.fallbackAttempts.find(a => a.success);
                if (successfulAttempt && successfulAttempt.rawClosingPrices) {
                    rawFallbackPrices = successfulAttempt.rawClosingPrices;
                }
            }
            
            if (rawFallbackPrices && rawFallbackPrices.length > 50) {
                const bTest = maBacktester.evaluateAll(rawFallbackPrices);
                
                if (bTest.results.length > 0) {
                    // Sort by periods asc
                    bTest.results.sort((a,b) => a.maPeriod - b.maPeriod);
                    
                    for (const r of bTest.results) {
                        const tr = document.createElement('tr');
                        const isBest = r.maPeriod === bTest.bestMa;
                        
                        if (isBest) {
                            tr.style.backgroundColor = "rgba(16, 185, 129, 0.1)";
                            tr.style.borderLeft = "3px solid #10b981";
                        }
                        
                        const stratCls = r.stratReturnPct >= 0 ? "change-positive" : "change-negative";
                        const holdCls = r.holdReturnPct >= 0 ? "change-positive" : "change-negative";
                        
                        tr.innerHTML = `
                            <td style="font-weight: 600;">${r.maPeriod}</td>
                            <td class="${stratCls}">${r.stratReturnPct > 0 ? '+' : ''}${r.stratReturnPct.toFixed(2)}%</td>
                            <td class="${holdCls}">${r.holdReturnPct > 0 ? '+' : ''}${r.holdReturnPct.toFixed(2)}%</td>
                            <td class="change-negative">-${r.maxDrawdown.toFixed(2)}%</td>
                            <td class="change-neutral">${r.flips}</td>
                            <td style="font-weight: 600;">${r.rankingScore.toFixed(0)}</td>
                        `;
                        maBody.appendChild(tr);
                    }
                    
                    // Add N/A for those that didn't fit
                    const testedPeriods = bTest.results.map(x => x.maPeriod);
                    for (const req of maBacktester.periodsToTest) {
                        if (!testedPeriods.includes(req)) {
                            const trErr = document.createElement('tr');
                            trErr.style.opacity = "0.6";
                            trErr.innerHTML = `
                                <td>${req}</td>
                                <td colspan="5" class="data-missing" style="text-align: center;">N/A (Insufficient History)</td>
                            `;
                            maBody.appendChild(trErr);
                        }
                    }
                    
                    elBestMa.textContent = bTest.bestMa ? bTest.bestMa.toString() : "N/A";
                    maPanel.style.display = "block";
                } else {
                    maPanel.style.display = "none";
                }
            } else {
                maPanel.style.display = "none";
            }
        }

        document.getElementById('analyze-btn').addEventListener('click', performAnalysis);
        
        ['symbol-input', 'ma-input'].forEach(id => {
            document.getElementById(id).addEventListener('keypress', (e) => {
                if (e.key === 'Enter') performAnalysis();
            });
        });

        // --- Watchlist Scanner Architecture ---
        class WatchlistScanner {
            constructor(engine, tbodyId, statusId, btnId, maInputId) {
                this.engine = engine;
                this.tbody = document.getElementById(tbodyId);
                this.statusEl = document.getElementById(statusId);
                this.scanBtn = document.getElementById(btnId);
                this.maInput = document.getElementById(maInputId);
                this.lastResults = [];
                this.sortKey = 'score';
                this.sortDesc = true;
                
                // Attach sort listeners
                document.querySelectorAll('th.sortable').forEach(th => {
                    th.addEventListener('click', () => this.handleSortClick(th.dataset.sort, th));
                });
                
                // Supports expanding into multiple watchlists later
                this.watchlists = {
                    default: [
                        'BTC', 'ETH', 'SOL', 'SUI', 'TAO',
                        'AAPL', 'MSFT', 'AMZN', 'NVDA', 'TSLA', 'META'
                    ]
                };
            }
            
            handleSortClick(key, element) {
                if (this.lastResults.length === 0) return;
                
                if (this.sortKey === key) {
                    this.sortDesc = !this.sortDesc;
                } else {
                    this.sortKey = key;
                    this.sortDesc = true; // default to desc on new column
                    if (key === 'slopeIsPositive' || key === 'symbol') this.sortDesc = false; // logic exception for certain types
                }
                
                // Update UI classes
                document.querySelectorAll('th.sortable').forEach(th => {
                    th.classList.remove('sort-asc', 'sort-desc');
                });
                element.classList.add(this.sortDesc ? 'sort-desc' : 'sort-asc');
                
                this.renderResults();
            }

            async scan(listName = 'default') {
                const symbols = this.watchlists[listName] || [];
                
                this.scanBtn.disabled = true;
                this.scanBtn.textContent = "Scanning...";
                this.tbody.innerHTML = '';
                this.statusEl.textContent = `Scanning ${symbols.length} assets concurrently...`;
                this.statusEl.className = 'status-message visible info-message';

                let maPeriod = parseInt(this.maInput.value, 10);
                if (isNaN(maPeriod) || maPeriod <= 0) maPeriod = 125;
                
                document.getElementById('th-ma').textContent = `MA(${maPeriod})`;

                // Crypto detection lists based on prompt requirement
                const isCrypto = (sym) => ['BTC', 'ETH', 'SOL', 'SUI', 'TAO'].includes(sym);
                const isStock = (sym) => ['AAPL', 'MSFT', 'AMZN', 'NVDA', 'TSLA', 'META'].includes(sym);

                let promises = symbols.map(async (symbol) => {
                    let rowData = {
                        symbol: symbol,
                        assetType: isCrypto(symbol) ? "Crypto" : (isStock(symbol) ? "Stock" : "Unknown"),
                        price: null,
                        maValue: null,
                        distancePercent: null,
                        atrValue: null,
                        atrDistance: null,
                        slopeIsPositive: null,
                        regime: "N/A",
                        direction: "N/A",
                        leverage: "N/A",
                        score: null,
                        status: "N/A"
                    };

                    try {
                        let data = await fetchAssetData(symbol, maPeriod, this.engine);
                        
                        if (data.price !== null && data.price !== undefined) {
                            rowData.price = data.price;
                            if (data.insufficientHistory) {
                                rowData.status = "Data incomplete";
                            } else if (data.hasEnoughData) {
                                rowData.status = "OK";
                                rowData.maValue = data.maValue;
                                rowData.distancePercent = data.distancePercent;
                                rowData.atrDistance = data.atrDistance;
                                rowData.atrValue = data.atrValue || null;
                                rowData.slopeIsPositive = data.slopeIsPositive;
                                rowData.regime = data.regime;
                                rowData.direction = data.direction;
                                rowData.leverage = data.leverage;
                                rowData.score = data.score !== null ? data.score : -999; 
                            } else {
                                rowData.status = "Data incomplete";
                            }
                        } else {
                            rowData.status = "Fetch failed";
                        }
                    } catch (err) {
                        const msg = err.message.toLowerCase();
                        console.error(`Scanner error for ${symbol}: ${err.message}`);
                        rowData.status = (msg.includes("unsupported") || msg.includes("unavailable") || msg.includes("not found")) 
                            ? "Unsupported" 
                            : "Fetch failed";
                    }
                    
                    if (rowData.score === null) rowData.score = -999;
                    return rowData;
                });

                let results = await Promise.all(promises);
                this.lastResults = results; // cache for sorting

                this.renderResults();
                
                this.statusEl.className = 'status-message';
                this.scanBtn.disabled = false;
                this.scanBtn.textContent = "Scan Watchlist";
            }

            renderResults() {
                // Apply active sort
                const key = this.sortKey;
                const desc = this.sortDesc;
                
                this.lastResults.sort((a, b) => {
                    let valA = a[key];
                    let valB = b[key];
                    
                    // Handle nulls / missing data safely
                    if (valA === null || valA === -999) valA = -Infinity;
                    if (valB === null || valB === -999) valB = -Infinity;

                    // Boolean sort
                    if (typeof valA === 'boolean') valA = valA ? 1 : 0;
                    if (typeof valB === 'boolean') valB = valB ? 1 : 0;
                    
                    if (valA < valB) return desc ? 1 : -1;
                    if (valA > valB) return desc ? -1 : 1;
                    return 0;
                });
                
                this.tbody.innerHTML = '';

                for (const r of this.lastResults) {
                    const tr = document.createElement('tr');
                    
                    // We must use standard global formatter
                    const fmtPrice = formatCurrency(r.price);
                    const fmtMA = formatCurrency(r.maValue);
                    
                    let fmtDist = "N/A";
                    let distClass = "data-missing";
                    if (r.distancePercent !== null) {
                        const sign = r.distancePercent > 0 ? "+" : "";
                        fmtDist = `${sign}${r.distancePercent.toFixed(2)}%`;
                        distClass = r.distancePercent > 0 ? "change-positive" : (r.distancePercent < 0 ? "change-negative" : "change-neutral");
                    }
                    
                    let fmtAtr = "N/A";
                    let atrClass = "data-missing";
                    if (r.atrDistance !== null) {
                        const atrSign = r.atrDistance > 0 ? "+" : "";
                        fmtAtr = `${atrSign}${r.atrDistance.toFixed(2)} ATR`;
                        atrClass = r.atrDistance > 0 ? "change-positive" : (r.atrDistance < 0 ? "change-negative" : "change-neutral");
                    }
                    
                    let fmtSlope = "N/A";
                    let slopeClass = "data-missing";
                    if (r.slopeIsPositive !== null) {
                        fmtSlope = r.slopeIsPositive ? "Rising" : "Falling";
                        slopeClass = r.slopeIsPositive ? "change-positive" : "change-negative";
                    }
                    
                    let regClass = r.regime === "Bullish" ? "change-positive" : (r.regime === "Bearish" ? "change-negative" : "data-missing");
                    let dirClass = r.direction === "Long" ? "change-positive" : (r.direction === "Short" ? "change-negative" : "data-missing");
                    
                    let scoreText = r.score === -999 ? "N/A" : r.score;
                    let scoreClass = r.score === -999 ? "data-missing" : "";
                    
                    let statusClass = "data-missing";
                    if (r.status === "OK") statusClass = "change-positive";
                    else if (r.status === "Data incomplete") statusClass = "change-neutral";
                    else if (r.status === "Fetch failed" || r.status === "Unsupported") statusClass = "change-negative";

                    let trStyle = "";
                    if (r.score !== -999) {
                        if (r.score >= 80) trStyle = "background-color: rgba(16, 185, 129, 0.15); border-left: 3px solid #10b981;";
                        else if (r.score >= 60) trStyle = "background-color: rgba(16, 185, 129, 0.05); border-left: 3px solid rgba(16, 185, 129, 0.5);";
                        else if (r.score >= 40) trStyle = "border-left: 3px solid #64748b;";
                        else trStyle = "background-color: rgba(239, 68, 68, 0.05); border-left: 3px solid rgba(239, 68, 68, 0.5);";
                    } else {
                        trStyle = "opacity: 0.6;";
                    }

                    tr.style.cssText = trStyle;

                    tr.innerHTML = `
                        <td style="font-weight: 600;">${r.symbol}</td>
                        <td class="${r.assetType === 'Crypto' ? 'change-neutral' : 'change-positive'}">${r.assetType}</td>
                        <td style="font-weight: 600;">${fmtPrice}</td>
                        <td class="${r.maValue === null ? 'data-missing' : ''}">${fmtMA}</td>
                        <td class="${distClass}">${fmtDist}</td>
                        <td class="${atrClass}">${fmtAtr}</td>
                        <td class="${slopeClass}">${fmtSlope}</td>
                        <td class="${regClass}">${r.regime}</td>
                        <td class="${dirClass}">${r.direction}</td>
                        <td class="${r.leverage === 'N/A' ? 'data-missing' : ''}">${r.leverage}</td>
                        <td class="${scoreClass}" style="font-weight: 600; text-align: center;">${scoreText}</td>
                        <td class="${statusClass}">${r.status}</td>
                    `;
                    
                    this.tbody.appendChild(tr);
                }
            }
        }
        
        // Init Watchlist Scanner
        const watchlistScanner = new WatchlistScanner(engine, 'scanner-tbody', 'scan-status', 'scan-btn', 'scan-ma-input');
        
        document.getElementById('scan-btn').addEventListener('click', () => {
            watchlistScanner.scan('default');
        });
        
        document.getElementById('scan-ma-input').addEventListener('blur', function() {
            let val = parseInt(this.value, 10);
            if (isNaN(val) || val <= 0) {
                this.value = '125';
            }
        });
