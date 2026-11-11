import type { ReactElement } from 'react';

/** The centred header of Connect's two steps, like the intro's: title, an optional lime serif line, one line under it. */
export function ConnectHeading({ title, secondLine, lede }: { title: string; secondLine?: string; lede: string }): ReactElement {
  return (
    <div className="sv-sync-connect-head">
      <h2 className="sv-sync-connect-heading">
        {title}
        {secondLine !== undefined && (
          <>
            <br />
            <em>{secondLine}</em>
          </>
        )}
      </h2>
      <p className="sv-sync-connect-lede">{lede}</p>
    </div>
  );
}

/** The round "1" / "2" over each column of the website's Connect. */
export function ConnectStepNumber({ stepNumber }: { stepNumber: number }): ReactElement {
  return (
    <span className="sv-sync-connect-number" role="img" aria-label={`Step ${String(stepNumber)}`}>
      {stepNumber}
    </span>
  );
}
