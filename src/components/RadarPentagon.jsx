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
 *  - data: [{ lever, selectedScore, topAvg?, bottomAvg? }]
 *  - showTop: boolean
 *  - showBottom: boolean
 */
export default function RadarPentagon({ data, showTop, showBottom }) {
  return (
    <div className="w-full h-[520px]">
      <ResponsiveContainer>
        {/* startAngle/endAngle chosen so the pentagon base is horizontal at the bottom */}
        <RadarChart data={data} startAngle={-126} endAngle={234}>
          {/* Polygon grid, straight edges, no circular rings */}
          <PolarGrid gridType="polygon" radialLines={true} />
          <PolarAngleAxis dataKey="lever" />
          {/* Hide numeric radius ticks; just use the polygon levels visually */}
          <PolarRadiusAxis angle={90} domain={[0, 100]} tick={false} />

          <Tooltip
            formatter={(val, name) => [`${Math.round(val ?? 0)}`, name]}
            labelFormatter={(label) => `${label}`}
          />

          {/* Selected person (primary) */}
          <Radar
            name="Selected"
            dataKey="selectedScore"
            stroke="#2563EB"     // blue-600
            fill="#2563EB"
            fillOpacity={0.35}
            strokeWidth={2}
          />

          {/* Optional overlays */}
          {showTop && (
            <Radar
              name="Top Performers (avg)"
              dataKey="topAvg"
              stroke="#16a34a"    // green-600
              fill="#16a34a"
              fillOpacity={0.25}
              strokeWidth={2}
            />
          )}

          {showBottom && (
            <Radar
              name="Bottom Performers (avg)"
              dataKey="bottomAvg"
              stroke="#dc2626"    // red-600
              fill="#dc2626"
              fillOpacity={0.2}
              strokeWidth={2}
            />
          )}

          <Legend />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  )
}
