/* Configuración de Tailwind compartida por las dos pantallas.
   Se carga después del CDN y antes de que la página se dibuje.
   Los colores son los institucionales; cada uno tiene un rol fijo y no se mezcla. */
tailwind.config = {
  theme: {
    extend: {
      colors: {
        canvas: '#FDF1E3',   // fondo de página
        paper: '#FFFFFF',    // tarjetas
        ink: '#17122B',      // texto principal
        ink2: '#3D3450',     // texto secundario fuerte
        line: '#EFE0CC',     // bordes
        line2: '#E1CDB2',    // bordes de campos e interactivos
        muted: '#746453',    // texto auxiliar
        panel: '#241A3F',    // superficies oscuras (toast, avisos)
        brand: { DEFAULT: '#243B7A', deep: '#16264F', soft: '#E8ECF6' },
        accent: { DEFAULT: '#FF9300', deep: '#B34700', soft: '#FFF0DA' },
        ok: { DEFAULT: '#209B8A', deep: '#17796B', ink: '#146356', soft: '#DDF2EE' },
        alert: { DEFAULT: '#C52525', deep: '#8E1919', soft: '#FAE6E6' },
        plum: { DEFAULT: '#7D2048', deep: '#5A1434', soft: '#F7E6EC' },
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
