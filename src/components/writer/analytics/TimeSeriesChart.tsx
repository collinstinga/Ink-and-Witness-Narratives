import React, { useState } from 'react';
import { 
  TrendingUp, 
  DollarSign, 
  ShoppingBag, 
  Eye, 
  Heart, 
  Calendar,
  Layers
} from 'lucide-react';
import { TimeSeriesPoint } from '../../../types.js';

interface TimeSeriesChartProps {
  timeSeries: TimeSeriesPoint[];
  periodLabel: string;
}

export const TimeSeriesChart: React.FC<TimeSeriesChartProps> = ({ 
  timeSeries = [], 
  periodLabel 
}) => {
  const [activeMetric, setActiveMetric] = useState<'revenue' | 'purchases' | 'views' | 'tips'>('revenue');
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const points = timeSeries.length > 0 ? timeSeries : [
    { date: new Date().toISOString().split('T')[0], revenueKes: 0, salesRevenueKes: 0, tipsRevenueKes: 0, purchasesCount: 0, viewsCount: 0, previewCount: 0, tipsCount: 0, uniqueReaders: 0 }
  ];

  // Extract metric values
  const getMetricValue = (pt: TimeSeriesPoint) => {
    switch (activeMetric) {
      case 'revenue': return pt.revenueKes || 0;
      case 'purchases': return pt.purchasesCount || 0;
      case 'views': return pt.viewsCount || 0;
      case 'tips': return pt.tipsRevenueKes || 0;
    }
  };

  const values = points.map(getMetricValue);
  const maxValue = Math.max(...values, activeMetric === 'revenue' || activeMetric === 'tips' ? 1000 : 5);
  const minValue = 0;
  const totalValue = values.reduce((sum, v) => sum + v, 0);
  const avgValue = Math.round(totalValue / Math.max(1, points.length));
  
  // Find peak point
  const peakValue = Math.max(...values);
  const peakIndex = values.indexOf(peakValue);
  const peakPoint = points[peakIndex] || points[0];

  // SVG dimensions
  const width = 800;
  const height = 240;
  const paddingLeft = 60;
  const paddingRight = 30;
  const paddingTop = 30;
  const paddingBottom = 40;

  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;

  // Calculate coordinates for points
  const coords = points.map((pt, i) => {
    const x = paddingLeft + (points.length === 1 ? chartWidth / 2 : (i / (points.length - 1)) * chartWidth);
    const normalizedY = (getMetricValue(pt) - minValue) / Math.max(1, maxValue - minValue);
    const y = paddingTop + chartHeight - normalizedY * chartHeight;
    return { x, y, pt, value: getMetricValue(pt) };
  });

  // Construct SVG path string (smooth curve using cubic bezier or polyline)
  const linePath = coords.reduce((acc, curr, idx, arr) => {
    if (idx === 0) return `M ${curr.x} ${curr.y}`;
    const prev = arr[idx - 1];
    const cpX1 = prev.x + (curr.x - prev.x) / 3;
    const cpY1 = prev.y;
    const cpX2 = curr.x - (curr.x - prev.x) / 3;
    const cpY2 = curr.y;
    return `${acc} C ${cpX1} ${cpY1}, ${cpX2} ${cpY2}, ${curr.x} ${curr.y}`;
  }, '');

  const areaPath = coords.length > 0
    ? `${linePath} L ${coords[coords.length - 1].x} ${paddingTop + chartHeight} L ${coords[0].x} ${paddingTop + chartHeight} Z`
    : '';

  // Theme colors per metric
  const metricConfigs = {
    revenue: {
      label: 'Confirmed Revenue',
      unit: 'KES',
      stroke: '#10b981', // emerald-500
      fillStart: 'rgba(16, 185, 129, 0.35)',
      fillEnd: 'rgba(16, 185, 129, 0.01)',
      icon: DollarSign,
      format: (val: number) => `KES ${val.toLocaleString()}`
    },
    purchases: {
      label: 'Confirmed Purchases',
      unit: 'Purchases',
      stroke: '#38bdf8', // sky-400
      fillStart: 'rgba(56, 189, 248, 0.35)',
      fillEnd: 'rgba(56, 189, 248, 0.01)',
      icon: ShoppingBag,
      format: (val: number) => `${val.toLocaleString()} purchases`
    },
    views: {
      label: 'Reader Views',
      unit: 'Views',
      stroke: '#818cf8', // indigo-400
      fillStart: 'rgba(129, 140, 248, 0.35)',
      fillEnd: 'rgba(129, 140, 248, 0.01)',
      icon: Eye,
      format: (val: number) => `${val.toLocaleString()} views`
    },
    tips: {
      label: 'Reader Tips',
      unit: 'KES',
      stroke: '#f43f5e', // rose-500
      fillStart: 'rgba(244, 63, 94, 0.35)',
      fillEnd: 'rgba(244, 63, 94, 0.01)',
      icon: Heart,
      format: (val: number) => `KES ${val.toLocaleString()}`
    }
  };

  const currentConfig = metricConfigs[activeMetric];
  const hoveredCoord = hoveredIndex !== null ? coords[hoveredIndex] : null;

  return (
    <div id="analytics-timeseries-chart" className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-6">
      
      {/* Top Header & Metric Selectors */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-sky-400 mb-1">
            <TrendingUp className="w-4 h-4" />
            <span>Time-Series Trajectory &amp; Growth</span>
          </div>
          <h3 className="font-serif font-bold text-xl text-white">
            Revenue &amp; Volume Velocity
          </h3>
          <p className="text-xs text-slate-400 font-sans mt-0.5">
            Verified ledger transactions mapped over <span className="text-slate-200 font-mono">{periodLabel}</span>.
          </p>
        </div>

        {/* Metric Selector Pills */}
        <div className="flex flex-wrap items-center gap-1.5 p-1 bg-slate-950/80 rounded-xl border border-slate-800">
          {(['revenue', 'purchases', 'views', 'tips'] as const).map((metric) => {
            const config = metricConfigs[metric];
            const Icon = config.icon;
            const isSelected = activeMetric === metric;
            return (
              <button
                key={metric}
                onClick={() => {
                  setActiveMetric(metric);
                  setHoveredIndex(null);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-mono font-medium transition-all flex items-center gap-1.5 cursor-pointer ${
                  isSelected
                    ? 'bg-slate-800 text-white shadow-sm border border-slate-700'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                <Icon className="w-3.5 h-3.5" style={{ color: isSelected ? config.stroke : undefined }} />
                <span>{config.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* SVG Interactive Chart Box */}
      <div className="relative w-full overflow-hidden bg-slate-950/60 rounded-xl border border-slate-800/80 p-2">
        <svg 
          viewBox={`0 0 ${width} ${height}`} 
          className="w-full h-auto overflow-visible select-none"
          onMouseLeave={() => setHoveredIndex(null)}
        >
          <defs>
            <linearGradient id={`gradient-${activeMetric}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={currentConfig.fillStart} />
              <stop offset="100%" stopColor={currentConfig.fillEnd} />
            </linearGradient>
          </defs>

          {/* Grid lines (horizontal) */}
          {[0, 0.25, 0.5, 0.75, 1].map((ratio, idx) => {
            const y = paddingTop + chartHeight * (1 - ratio);
            const labelVal = Math.round(minValue + (maxValue - minValue) * ratio);
            return (
              <g key={idx}>
                <line 
                  x1={paddingLeft} 
                  y1={y} 
                  x2={width - paddingRight} 
                  y2={y} 
                  stroke="#1e293b" 
                  strokeDasharray="4 4" 
                  strokeWidth="1" 
                />
                <text 
                  x={paddingLeft - 10} 
                  y={y + 3} 
                  fill="#64748b" 
                  fontSize="10" 
                  fontFamily="monospace" 
                  textAnchor="end"
                >
                  {activeMetric === 'revenue' || activeMetric === 'tips' ? `${labelVal >= 1000 ? `${Math.round(labelVal/1000)}k` : labelVal}` : labelVal}
                </text>
              </g>
            );
          })}

          {/* Area Fill */}
          {areaPath && (
            <path 
              d={areaPath} 
              fill={`url(#gradient-${activeMetric})`} 
            />
          )}

          {/* Line Path */}
          {linePath && (
            <path 
              d={linePath} 
              fill="none" 
              stroke={currentConfig.stroke} 
              strokeWidth="2.5" 
              strokeLinecap="round" 
              strokeLinejoin="round" 
            />
          )}

          {/* Interactive Data Points & Hover Targets */}
          {coords.map((c, i) => {
            const isHovered = hoveredIndex === i;
            return (
              <g key={i}>
                {/* Vertical hover line */}
                {isHovered && (
                  <line 
                    x1={c.x} 
                    y1={paddingTop} 
                    x2={c.x} 
                    y2={paddingTop + chartHeight} 
                    stroke={currentConfig.stroke} 
                    strokeWidth="1" 
                    strokeDasharray="2 2" 
                    opacity="0.8" 
                  />
                )}

                {/* Point dot */}
                <circle 
                  cx={c.x} 
                  y={c.y} 
                  r={isHovered ? 6 : coords.length <= 15 ? 3.5 : 2} 
                  fill="#0f172a" 
                  stroke={currentConfig.stroke} 
                  strokeWidth={isHovered ? 2.5 : 1.5} 
                  className="transition-all cursor-pointer"
                />

                {/* Invisible hit target for smoother hovering */}
                <rect 
                  x={c.x - (chartWidth / points.length) / 2} 
                  y={paddingTop} 
                  width={chartWidth / points.length} 
                  height={chartHeight} 
                  fill="transparent" 
                  className="cursor-pointer"
                  onMouseEnter={() => setHoveredIndex(i)}
                />
              </g>
            );
          })}

          {/* X Axis Date Labels */}
          {coords.filter((_, idx) => {
            if (coords.length <= 8) return true;
            if (coords.length <= 16) return idx % 2 === 0;
            if (coords.length <= 31) return idx % 5 === 0 || idx === coords.length - 1;
            return idx % 10 === 0 || idx === coords.length - 1;
          }).map((c, idx) => {
            const dateStr = c.pt.date;
            const shortLabel = dateStr.includes('-') 
              ? dateStr.split('-').slice(1).join('/')
              : dateStr;
            return (
              <text 
                key={idx} 
                x={c.x} 
                y={height - 12} 
                fill="#64748b" 
                fontSize="10" 
                fontFamily="monospace" 
                textAnchor="middle"
              >
                {shortLabel}
              </text>
            );
          })}
        </svg>

        {/* Hover Tooltip Overlay */}
        {hoveredCoord && (
          <div 
            className="absolute z-20 pointer-events-none p-3 rounded-xl bg-slate-900/95 border border-slate-700 shadow-2xl backdrop-blur-md text-xs font-mono space-y-1.5"
            style={{
              left: `${Math.min(Math.max(hoveredCoord.x, 120), width - 150)}px`,
              top: `${Math.max(10, hoveredCoord.y - 80)}px`,
              transform: 'translate(-50%, 0)'
            }}
          >
            <div className="text-[11px] text-slate-400 border-b border-slate-800 pb-1 font-semibold flex items-center justify-between gap-4">
              <span>{hoveredCoord.pt.date}</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-300">
                {activeMetric.toUpperCase()}
              </span>
            </div>
            <div className="text-sm font-bold text-white flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: currentConfig.stroke }} />
              <span>{currentConfig.format(hoveredCoord.value)}</span>
            </div>
            <div className="text-[10px] text-slate-400 space-y-0.5 pt-0.5">
              <div>Purchases: <span className="text-sky-300 font-semibold">{hoveredCoord.pt.purchasesCount}</span></div>
              <div>Views: <span className="text-indigo-300 font-semibold">{hoveredCoord.pt.viewsCount}</span></div>
              <div>Tips: <span className="text-rose-300 font-semibold">KES {hoveredCoord.pt.tipsRevenueKes.toLocaleString()}</span></div>
            </div>
          </div>
        )}
      </div>

      {/* Summary Footer Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-slate-800/60 font-mono text-xs">
        <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 flex items-center justify-between">
          <span className="text-slate-400">Period Total:</span>
          <span className="font-bold text-white">{currentConfig.format(totalValue)}</span>
        </div>

        <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 flex items-center justify-between">
          <span className="text-slate-400">Daily Average:</span>
          <span className="font-bold text-slate-200">{currentConfig.format(avgValue)}/day</span>
        </div>

        <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 flex items-center justify-between">
          <span className="text-slate-400">Peak Velocity:</span>
          <span className="font-bold text-emerald-400">
            {currentConfig.format(peakValue)} <span className="text-[10px] text-slate-500 font-normal">({peakPoint?.date})</span>
          </span>
        </div>
      </div>

    </div>
  );
};
