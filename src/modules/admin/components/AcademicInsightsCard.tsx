// src/modules/admin/components/AcademicInsightsCard.tsx
//
// Compact metric card used on the Academic Insights page. Takes a label, a
// primary value, and an optional hint/secondary line. Colours the hint via a
// semantic tone so low completion / low attendance reads at a glance.

import React from 'react'
import { Card, CardContent, Typography, Box, LinearProgress } from '@mui/material'

export interface AcademicInsightsCardProps {
  label: string
  value: React.ReactNode
  hint?: React.ReactNode
  /** Optional progress bar 0–100. */
  progress?: number
  /** Tone for the progress bar + value colour. */
  tone?: 'default' | 'success' | 'warning' | 'danger'
}

function toneColor(tone: AcademicInsightsCardProps['tone']): string {
  switch (tone) {
    case 'success': return '#15803d'
    case 'warning': return '#b45309'
    case 'danger':  return '#b91c1c'
    default:       return 'inherit'
  }
}

function toneMuiColor(tone: AcademicInsightsCardProps['tone']): 'success' | 'warning' | 'error' | 'primary' {
  switch (tone) {
    case 'success': return 'success'
    case 'warning': return 'warning'
    case 'danger':  return 'error'
    default:       return 'primary'
  }
}

export function progressTone(pct: number | null | undefined): AcademicInsightsCardProps['tone'] {
  if (pct === null || pct === undefined) return 'default'
  if (pct >= 75) return 'success'
  if (pct >= 50) return 'warning'
  return 'danger'
}

export default function AcademicInsightsCard({
  label,
  value,
  hint,
  progress,
  tone = 'default',
}: AcademicInsightsCardProps) {
  return (
    <Card variant="outlined" sx={{ flex: '1 1 180px', minWidth: 160 }}>
      <CardContent sx={{ py: 2 }}>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ textTransform: 'uppercase', letterSpacing: 0.6, display: 'block' }}
        >
          {label}
        </Typography>
        <Typography
          variant="h5"
          sx={{ fontWeight: 600, mt: 0.5, color: toneColor(tone) }}
        >
          {value}
        </Typography>
        {typeof progress === 'number' && Number.isFinite(progress) && (
          <Box sx={{ mt: 1 }}>
            <LinearProgress
              variant="determinate"
              value={Math.max(0, Math.min(100, progress))}
              color={toneMuiColor(tone)}
              sx={{ height: 6, borderRadius: 3 }}
            />
          </Box>
        )}
        {hint && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
            {hint}
          </Typography>
        )}
      </CardContent>
    </Card>
  )
}
