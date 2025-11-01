// /app/frontend/src/hooks/useSafeZone.js
import { useEffect, useState, useCallback } from "react";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";

export function useSafeZone(db, userId) {
  const [polygon, setPolygon] = useState([]); // [{x:0..1,y:0..1}, ...]
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const ref = userId ? doc(db, "safezones", userId) : null;

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!ref) return;
      setLoading(true);
      try {
        const snap = await getDoc(ref);
        if (alive && snap.exists()) setPolygon(snap.data().polygon || []);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [userId]);

  const save = useCallback(async (normalized) => {
    if (!ref) return;
    setSaving(true);
    try {
      await setDoc(ref, {
        polygon: normalized,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      setPolygon(normalized);
    } finally {
      setSaving(false);
    }
  }, [userId]);

  return { polygon, setPolygon, save, loading, saving };
}
