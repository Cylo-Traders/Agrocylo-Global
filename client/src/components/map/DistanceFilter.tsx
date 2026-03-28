"use client";

const DISTANCES = [
  { label: "10 km", value: 10 },
  { label: "25 km", value: 25 },
  { label: "50 km", value: 50 },
  { label: "100 km", value: 100 },
  { label: "All", value: 0 },
];

interface DistanceFilterProps {
  selected: number;
  onChange: (km: number) => void;
}

export default function DistanceFilter({ selected, onChange }: DistanceFilterProps) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-white/90 p-2 shadow-md backdrop-blur-sm">
      <span className="text-sm font-medium text-neutral-600 px-1">Range:</span>
      {DISTANCES.map(({ label, value }) => (
        <button
          key={value}
          onClick={() => onChange(value)}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            selected === value
              ? "bg-primary-600 text-white"
              : "text-neutral-700 hover:bg-neutral-100"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
