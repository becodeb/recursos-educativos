/* Configuración de Tailwind compartida por las dos pantallas.
   Se carga después del CDN y antes de que la página se dibuje.
   Los colores son los institucionales; cada uno tiene un rol fijo y no se mezcla. */
tailwind.config = {
  theme: {
    extend: {
      colors: {
        canvas: '#AFC4E8',   // fondo de página (base del degradado)
        inset: '#E8ECF8',    // superficies hundidas dentro de las tarjetas
        paper: '#FFFFFF',    // tarjetas
        ink: '#17122B',      // texto principal
        ink2: '#4B2D68',     // texto secundario (violeta institucional)
        line: '#BFC7DC',     // bordes
        line2: '#A3ADCA',    // bordes de campos e interactivos
        muted: '#474154',    // texto auxiliar
        purple: '#4B2D68',   // cabecera del panel docente
        panel: '#241A3F',    // superficies oscuras (toast, avisos)
        brand: { DEFAULT: '#243B7A', deep: '#16264F', soft: '#DCE3F2' },
        accent: { DEFAULT: '#FF9300', deep: '#8F3600', urgente: '#E4510B', soft: '#FFE8C6' },
        ok: { DEFAULT: '#209B8A', deep: '#17796B', ink: '#146356', soft: '#C9EAE3' },
        alert: { DEFAULT: '#C52525', deep: '#8E1919', soft: '#F7D6D6' },
        plum: { DEFAULT: '#7D2048', deep: '#5A1434', soft: '#F2D9E1' },
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        body: ['"Instrument Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        soft: '0 1px 2px rgba(93, 58, 12, .06)',
        card: '0 2px 4px rgba(93, 58, 12, .05), 0 8px 20px -10px rgba(93, 58, 12, .16)',
        pop: '0 4px 8px rgba(93, 58, 12, .07), 0 20px 48px -14px rgba(93, 58, 12, .28)',
      },
      borderRadius: { xl2: '1.25rem' },
    },
  },
};
