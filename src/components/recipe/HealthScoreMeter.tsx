'use client';

interface HealthScoreMeterProps {
  score: number; // 0-100
  size?: 'sm' | 'md' | 'lg';
}

export function HealthScoreMeter({ score, size = 'sm' }: HealthScoreMeterProps) {
  // Clamp score between 0 and 100
  const clampedScore = Math.max(0, Math.min(100, score));
  
  // Calculate rotation for half circle (180 degrees total)
  // 0 score = 0 degrees, 100 score = 180 degrees
  const rotation = (clampedScore / 100) * 180;
  
  // Determine color based on score
  const getColor = (score: number): string => {
    if (score >= 80) return '#22c55e'; // green-500
    if (score >= 60) return '#84cc16'; // lime-500
    if (score >= 40) return '#eab308'; // yellow-500
    if (score >= 20) return '#f97316'; // orange-500
    return '#ef4444'; // red-500
  };
  
  const color = getColor(clampedScore);
  
  // Size configurations
  const sizes = {
    sm: { width: 60, height: 30, strokeWidth: 4, fontSize: 10 },
    md: { width: 80, height: 40, strokeWidth: 5, fontSize: 12 },
    lg: { width: 100, height: 50, strokeWidth: 6, fontSize: 14 },
  };
  
  const config = sizes[size];
  const radius = (config.width / 2) - (config.strokeWidth / 2);
  const circumference = Math.PI * radius; // Half circle circumference
  
  // Calculate stroke dash offset for the progress
  const dashOffset = circumference - (rotation / 180) * circumference;
  
  return (
    <div className="flex flex-col items-center">
      <svg 
        width={config.width} 
        height={config.height}
        viewBox={`0 0 ${config.width} ${config.height}`}
        className="overflow-visible"
      >
        {/* Background arc */}
        <path
          d={`M ${config.strokeWidth / 2} ${config.height} A ${radius} ${radius} 0 0 1 ${config.width - config.strokeWidth / 2} ${config.height}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={config.strokeWidth}
          className="text-muted/20"
          strokeLinecap="round"
        />
        
        {/* Progress arc */}
        <path
          d={`M ${config.strokeWidth / 2} ${config.height} A ${radius} ${radius} 0 0 1 ${config.width - config.strokeWidth / 2} ${config.height}`}
          fill="none"
          stroke={color}
          strokeWidth={config.strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          style={{
            transition: 'stroke-dashoffset 0.3s ease-in-out, stroke 0.3s ease-in-out',
          }}
        />
        
        {/* Score text */}
        <text
          x={config.width / 2}
          y={config.height - 2}
          textAnchor="middle"
          fontSize={config.fontSize}
          fontWeight="bold"
          fill="currentColor"
          className="text-foreground"
        >
          {Math.round(clampedScore)}
        </text>
      </svg>
    </div>
  );
}

