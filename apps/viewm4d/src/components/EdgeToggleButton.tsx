interface Props {
  side: 'left' | 'right';
  onClick: () => void;
  label?: string;
}

export function EdgeToggleButton({ side, onClick, label }: Props) {
  const isLeft = side === 'left';

  return (
    <button
      type="button"
      onClick={onClick}
      className={`
        absolute top-1/2 -translate-y-1/2 z-20
        ${isLeft ? 'left-0' : 'right-0'}
        group flex items-center
        transition-all duration-200 ease-out
      `}
      aria-label={label ? `Open ${label}` : `Open ${side} panel`}
    >
      {/* Pill container with bright blue and highlight border */}
      <div
        className={`
          relative flex items-center gap-1.5 py-3 px-1.5
          bg-blue-500 backdrop-blur-sm
          border-2 border-blue-400
          shadow-lg shadow-blue-500/40
          transition-all duration-200
          group-hover:bg-blue-600 group-hover:border-blue-300 group-hover:shadow-xl group-hover:shadow-blue-500/60
          ${isLeft 
            ? 'rounded-r-full pl-0.5 pr-2' 
            : 'rounded-l-full pr-0.5 pl-2 flex-row-reverse'
          }
        `}
      >
        {/* Highlight border effect */}
        <div
          className={`
            absolute inset-0 rounded-full
            bg-gradient-to-r from-blue-300/50 via-cyan-300/50 to-blue-300/50
            opacity-60 blur-sm
            ${isLeft ? 'rounded-r-full' : 'rounded-l-full'}
          `}
        />
        
        {/* Content wrapper */}
        <div className="relative z-10 flex items-center gap-1.5">
          {/* Chevron icon */}
          <svg
            className={`
              w-4 h-4 text-white transition-colors duration-200
              group-hover:text-blue-50
              ${isLeft ? '' : 'rotate-180'}
            `}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5l7 7-7 7"
            />
          </svg>

          {/* Label (vertical text) */}
          {label && (
            <span
              className={`
                text-xs font-medium text-white tracking-wide
                transition-colors duration-200
                group-hover:text-blue-50
                [writing-mode:vertical-lr]
                ${isLeft ? '' : 'rotate-180'}
              `}
            >
              {label}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

