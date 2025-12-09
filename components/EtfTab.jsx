// components/EtfTab.jsx
'use client';
import { useState, useEffect } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, BarChart, Bar } from 'recharts';
import { motion } from 'framer-motion';
import Image from 'next/image';

const etfColors = [
    '#00FF88', '#00E7FF', '#FF44AA', '#FFD700', '#FF6B6B',
    '#9D4EDD', '#32CD32', '#00D4FF', '#FF1493', '#FFA500',
    '#1E90FF', '#FF69B4'
];

export const formatPrice = (num) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(num);

const safeFixed = (v, decimals = 1) => {
    const num = Number(v || 0);
    return isNaN(num) ? '0' : num.toFixed(decimals);
};

// Custom Tooltip for Area/Line Chart (ETF flows)
const CustomAreaTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
        return (
            <motion.div
                className="bg-[#0A0A0A]/95 backdrop-blur-xl border border-[#FFFFFF20] p-4 rounded-2xl text-[#FFF] text-sm font-medium shadow-2xl"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.2 }}
            >
                <p className="text-[#D4D4D4] text-xs mb-2">{label}</p>
                {payload.map((entry, i) => {
                    const value = entry.value || 0;
                    const isOutflow = value < 0;
                    const flowType = isOutflow ? ' (Outflow)' : ' (Inflow)';
                    const absValue = Math.abs(value);
                    return (
                        <div key={i} className="flex items-center gap-3">
                            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: entry.color }} />
                            <span className="text-[#FFF]">{entry.name}:</span>
                            <span className={`font-bold ${isOutflow ? 'text-red-500/60' : 'text-emerald-400'}`}>
                                ${safeFixed(absValue)}M{flowType}
                            </span>
                        </div>
                    );
                })}
            </motion.div>
        );
    }
    return null;
};

// Custom Tooltip for Bar Chart (Inflow/Outflow)
const CustomBarTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
        return (
            <motion.div
                className="bg-[#0A0A0A]/95 backdrop-blur-xl border border-[#FFFFFF20] p-4 rounded-2xl text-[#FFF] text-sm font-medium shadow-2xl"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.2 }}
            >
                <p className="text-[#D4D4D4] text-xs mb-2">{label}</p>
                {payload.map((entry, i) => {
                    const isOutflow = entry.name === 'outflow' || entry.value < 0;
                    const flowType = entry.name === 'outflow' ? ' (Outflow)' :
                        entry.name === 'inflow' ? ' (Inflow)' :
                            entry.value > 0 ? ' (Inflow)' : ' (Outflow)';
                    return (
                        <div key={i} className="flex items-center gap-3">
                            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: entry.color }} />
                            <span className="text-[#FFF]">{entry.name}:</span>
                            <span className={`font-bold ${isOutflow ? 'text-red-500/60' : 'text-emerald-400'}`}>
                                ${Math.abs(entry.value).toFixed(1)}M{flowType}
                            </span>
                        </div>
                    );
                })}
            </motion.div>
        );
    }
    return null;
};

// Manual Legend for ETF filtering
const ManualLegend = ({ activeSymbols, setActiveSymbols, topSymbols, symbolToColor }) => {
    const toggleSymbol = (symbol) => {
        if (symbol === 'ALL') {
            setActiveSymbols(topSymbols);
            return;
        }
        setActiveSymbols((prev) => {
            const newActive = prev.includes(symbol) ? prev.filter((s) => s !== symbol) : [...prev, symbol];
            // If empty after toggle, reset to ALL
            return newActive.length === 0 ? topSymbols : newActive;
        });
    };

    const isAllActive = activeSymbols.length === topSymbols.length;

    return (
        <div className="flex flex-wrap justify-end gap-2 mb-3">
            <div
                onClick={() => toggleSymbol('ALL')}
                className={`cursor-pointer flex items-center gap-1 px-2 py-1 rounded-md transition-colors ${
                    isAllActive ? 'bg-[#FFFFFF20] text-white' : 'text-[#888]'
                }`}
            >
                <div className="w-2 h-2 rounded-sm bg-gray-500" />
                <span className="text-[10px] font-medium">ALL</span>
            </div>
            {topSymbols.map((sym) => {
                const color = symbolToColor[sym];
                const isActive = activeSymbols.includes(sym);
                return (
                    <div
                        key={sym}
                        onClick={() => toggleSymbol(sym)}
                        className={`cursor-pointer flex items-center gap-1 px-2 py-1 rounded-md transition-colors ${
                            isActive ? 'bg-[#FFFFFF20] text-white' : 'text-[#888]'
                        }`}
                    >
                        <div
                            className="w-2 h-2 rounded-sm shadow-lg"
                            style={{ backgroundColor: color, boxShadow: `0 0 10px ${color}80` }}
                        />
                        <span className="text-[10px] font-medium">{sym}</span>
                    </div>
                );
            })}
        </div>
    );
};

export default function EtfTab() {
    const [chartArray, setChartArray] = useState([]);
    const [flowChartData, setFlowChartData] = useState([]);
    const [tableData, setTableData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [activeSymbols, setActiveSymbols] = useState([]);

    useEffect(() => {
        fetch('/api/etf-data')
            .then(res => res.json())
            .then(data => {
                setChartArray(data.chartArray);
                setFlowChartData(data.flowChartData);
                setTableData(data.tableData);
                setActiveSymbols(data.chartArray.length > 0 ? Object.keys(data.chartArray[0]).filter(k => k !== 'date') : []);
            })
            .catch(err => setError(err.message))
            .finally(() => setLoading(false));
    }, []);

    if (loading) return <div className="flex justify-center items-center h-full text-[#D4D4D4]">Loading ETF data...</div>;
    if (error) return <div className="flex justify-center items-center h-full text-red-500/60">Error: {error}</div>;

    // Top 6 ETFs cho chart
    const topSymbols = ['IBIT', 'FBTC', 'GBTC' , 'BTC', 'BITB' , 'ARKB', 'HODL'];

    const symbolToColor = {};
    topSymbols.forEach((sym, i) => {
        symbolToColor[sym] = etfColors[i % etfColors.length];
    });

    const isSingle = activeSymbols.length === 1;
    const currentSymbol = isSingle ? activeSymbols[0] : null;
    const currentColor = currentSymbol ? symbolToColor[currentSymbol] : null;

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full h-full p-4 bg-[#0A0A0A]/80 backdrop-blur-md flex flex-col md:flex-row gap-6 overflow-y-auto"
        >
            {/* Left: Charts */}
            <div className="w-full md:w-3/5 flex flex-col gap-6">

                {/* Daily Net Flows - Area/Line Chart */}
                <motion.div
                    className="h-[380px] border border-[#FFFFFF20] rounded-2xl bg-[#0A0A0A]/90 backdrop-blur-xl shadow-2xl glow-[#FFFFFF10] p-6 relative"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                >
                    <h3 className="text-sm font-bold text-[#FFF] mb-2">
                        Daily Net Flows by Top ETFs ($M USD){isSingle && ` - ${currentSymbol}`}
                    </h3>
                    <ManualLegend
                        activeSymbols={activeSymbols}
                        setActiveSymbols={setActiveSymbols}
                        topSymbols={topSymbols}
                        symbolToColor={symbolToColor}
                    />
                    <ResponsiveContainer width="100%" height="85%">
                        {isSingle ? (
                            <LineChart data={chartArray} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                                <CartesianGrid stroke="#333333" strokeDasharray="4 4" />
                                <XAxis dataKey="date" stroke="#888" tick={{ fontSize: 11 }} />
                                <YAxis stroke="#888" tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v.toFixed(0)}M`} />
                                <Tooltip content={<CustomAreaTooltip />} cursor={{ stroke: '#FFF', strokeWidth: 1, strokeDasharray: '5 5' }} />
                                <Line
                                    type="monotone"
                                    dataKey={currentSymbol}
                                    stroke={currentColor}
                                    strokeWidth={3}
                                    dot={{ r: 4, stroke: '#FFF', strokeWidth: 2 }}
                                    activeDot={{ r: 6, stroke: '#FFF', strokeWidth: 2 }}
                                />
                            </LineChart>
                        ) : (
                            <AreaChart data={chartArray} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                                <defs>
                                    {activeSymbols.map((sym, i) => (
                                        <linearGradient key={sym} id={`gradient-${sym}`} x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="0%" stopColor={symbolToColor[sym]} stopOpacity={0.6} />
                                            <stop offset="100%" stopColor={symbolToColor[sym]} stopOpacity={0.05} />
                                        </linearGradient>
                                    ))}
                                </defs>
                                <CartesianGrid stroke="#333333" strokeDasharray="4 4" />
                                <XAxis dataKey="date" stroke="#888" tick={{ fontSize: 11 }} />
                                <YAxis stroke="#888" tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v.toFixed(0)}M`} />
                                <Tooltip content={<CustomAreaTooltip />} cursor={{ stroke: '#FFF', strokeWidth: 1, strokeDasharray: '5 5' }} />
                                {activeSymbols.map((symbol) => (
                                    <Area
                                        key={symbol}
                                        type="monotone"
                                        dataKey={symbol}
                                        stroke={symbolToColor[symbol]}
                                        strokeWidth={2}
                                        fillOpacity={1}
                                        fill={`url(#gradient-${symbol})`}
                                        dot={false}
                                        activeDot={{ r: 6, stroke: '#FFF', strokeWidth: 2 }}
                                    />
                                ))}
                            </AreaChart>
                        )}
                    </ResponsiveContainer>
                </motion.div>

                {/* Inflow vs Outflow Bar */}
                <motion.div
                    className="h-[242px] border border-[#FFFFFF20] rounded-2xl bg-[#0A0A0A]/90 backdrop-blur-xl shadow-2xl glow-[#FFFFFF10] p-6"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                >
                    <h3 className="text-sm font-bold text-[#FFF] mb-4">Total Inflow vs Outflow</h3>
                    <ResponsiveContainer width="100%" height="95%">
                        <BarChart data={flowChartData}>
                            <CartesianGrid stroke="#333333" strokeDasharray="4 4" />
                            <XAxis dataKey="date" stroke="#888" tick={{ fontSize: 11 }} />
                            <YAxis stroke="#888" tick={{ fontSize: 11 }} />
                            <Tooltip content={<CustomBarTooltip />} />
                            <Bar dataKey="inflow" fill="#00FF88" radius={[4, 4, 0, 0]} />
                            <Bar dataKey="outflow" fill="#FF4444" radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </motion.div>
            </div>

            {/* Right: Table */}
            <motion.div
                className="w-full md:w-2/5 min-h-[500px] md:min-h-[550px] max-h-[644px] border border-[#FFFFFF20] rounded-2xl bg-[#0A0A0A]/90 backdrop-blur-xl shadow-2xl glow-[#FFFFFF10] p-6 overflow-y-auto overflow-x-hidden table-scrollbar"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.3 }}
            >
                <h3 className="text-sm font-bold text-[#FFF] mb-6">Top Bitcoin ETF Holdings & Flows</h3>
                <div className="space-y-4">
                    {tableData.map((etf, i) => (
                        <motion.div
                            key={i}
                            className="flex flex-col sm:flex-row items-start gap-2 sm:gap-4 p-4 bg-[#FFFFFF]/5 rounded-xl border border-[#FFFFFF10] hover:border-[#FFFFFF30] transition-all"
                        >
                            <div className="flex flex-col items-start gap-1 flex-shrink-0">
                                <Image 
                                    width={40} 
                                    height={40}
                                    src={etf.image}
                                    alt={etf.name} 
                                    className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg shadow-lg flex-shrink-0" 
                                />
                                <div className="text-xs sm:text-sm font-bold text-white m-1">{etf.name}</div>
                                <div className="text-xs text-[#D4D4D4]">Ticker: <span className="text-emerald-400 font-bold">{etf.symbol}</span></div>
                            </div>
                            <div className="flex-1 w-full sm:ml-auto sm:text-right text-xs space-y-0.5 sm:space-y-1">
                                <div className="text-[#D4D4D4]">Holding</div>
                                <div className="text-sm sm:text-base font-bold text-white">{(etf.totalHolding / 1000).toFixed(3)} BTC</div>
                                <div className="text-xs text-[#888]">{formatPrice(etf.valueUSD)}</div>
                                <div className={etf.inflow > 0 ? 'text-emerald-400 font-bold' : 'text-gray-500'}>
                                    {etf.inflow > 0 ? `+$${etf.inflow.toFixed(0)}M` : '–'}
                                </div>
                                <div className={etf.outflow > 0 ? 'text-red-500/60 font-bold' : 'text-gray-500'}>
                                    {etf.outflow > 0 ? `–$${etf.outflow.toFixed(0)}M` : '–'}
                                </div>
                            </div>
                        </motion.div>
                    ))}
                </div>
            </motion.div>
        </motion.div>
    );
}