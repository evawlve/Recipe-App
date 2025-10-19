import React from 'react';

interface ProvisionalHintProps {
  provisional: boolean;
  provisionalReasons: string[];
}

export function ProvisionalHint({ provisional, provisionalReasons }: ProvisionalHintProps) {
  if (!provisional) {
    return null;
  }

  return (
    <div className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
      Provisional totals — {provisionalReasons.join('; ')}
    </div>
  );
}
