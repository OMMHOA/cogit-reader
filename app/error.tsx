"use client";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="page narrow">
      <h1>Valami hiba történt</h1>
      <p>Próbáld újra egy perc múlva. Ha nem múlik el, szólj a fordítónak.</p>
      <button className="primary" onClick={reset}>
        Újra
      </button>
    </div>
  );
}
