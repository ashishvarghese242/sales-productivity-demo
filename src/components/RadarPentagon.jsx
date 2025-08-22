import React from 'react'
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'

/**
 * Props:
 *  - data: [{ lever, selectedScore, topAvg?, bottomAvg?, lrsOverlay? }]
 *  - showPerformance: boolean
 *  - showTop: boolean
 *  - showBottom: boolean
 *  - showLRS: boolean
 */
export default function RadarPentagon({ data, showPerformance, showTop, showBottom, showLRS }) {
  return (
    <div className="w-full h-[520px]">
      <ResponsiveContainer>
        {/* Flat-base pentagon (no circular rings) */}
        <RadarChart data={data} startAngle={-126} endAngle={234}>
          <PolarGrid gridType="polygon" radialLines={true} />
          <PolarAngleAxis dataKey="lever" />
          <PolarRadiusAxis angle={90} domain={[0, 100]} tick={false} />

          <Tooltip
            formatter={(val, name) => [`${Math.round(val ?? 0)}`, name]}
            labelFormatter={(label) => `${label}`}
          />

          {/* Performance (Selected cohort or person) */}
          {showPerformance && (
            <Radar
              name="Performance"
              dataKey="selectedScore"
              stroke="#2563EB"     // blue-600
              fill="#2563EB"
              fillOpacity={0.35}
              strokeWidth={2}
            />
          )}

          {showTop && (
            <Radar
              name="Top"
              dataKey="topAvg"
              stroke="#16a34a"    // green-600
              fill="#16a34a"
              fillOpacity={0.25}
              strokeWidth={2}
            />
          )}

          {showBottom && (
            <Radar
              name="Bottom"
              dataKey="bottomAvg"
              stroke="#dc2626"    // red-600
              fill="#dc2626"
              fillOpacity={0.2}
              strokeWidth={2}
            />
          )}

          {showLRS && (
            <Radar
              name="Enablement"
              dataKey="lrsOverlay"
              stroke="#7c3aed"    // purple-600
              fill="#7c3aed"
              fillOpacity={0.35}
              strokeWidth={2}
            />
          )}

          <Legend />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  )
}
