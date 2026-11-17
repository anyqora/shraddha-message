"use client";

import { useState } from "react";

const PRESETS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
};

export function AiProviderField({ baseUrl, disabled }: { baseUrl: string; disabled?: boolean }) {
  const initial = Object.entries(PRESETS).find(([, u]) => u === baseUrl)?.[0] ?? "custom";
  const [preset, setPreset] = useState(initial);
  const [url, setUrl] = useState(baseUrl);
  return (
    <div className="grid gap-2 sm:grid-cols-[160px_1fr]">
      <select
        name="aiProvider"
        value={preset}
        disabled={disabled}
        onChange={(e) => {
          setPreset(e.target.value);
          if (PRESETS[e.target.value]) setUrl(PRESETS[e.target.value]);
        }}
        className="input"
      >
        <option value="openai">OpenAI</option>
        <option value="openrouter">OpenRouter</option>
        <option value="gemini">Google Gemini</option>
        <option value="custom">Custom (OpenAI-compatible)</option>
      </select>
      <input
        name="aiBaseUrl"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        readOnly={preset !== "custom"}
        disabled={disabled}
        placeholder="https://your-provider/v1"
        className="input"
      />
    </div>
  );
}
