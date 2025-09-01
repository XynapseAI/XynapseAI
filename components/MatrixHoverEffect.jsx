export default function MatrixHoverEffect({ text, hoverColor = '#00BFFF' }) {
  const handleMouseEnter = (e) => {
    const container = e.currentTarget.querySelector('.matrix-text');
    if (container) {
      container.classList.add('active');
      const spans = container.querySelectorAll('span');
      const positions = Array.from(spans).map((span) => span.offsetLeft);
      const charCount = spans.length;

      const shuffledIndices1 = Array.from({ length: charCount }, (_, i) => i);
      const shuffledIndices2 = Array.from({ length: charCount }, (_, i) => i);
      const shuffledIndices3 = Array.from({ length: charCount }, (_, i) => i);
      for (let i = charCount - 1; i > 0; i--) {
        const j1 = Math.floor(Math.random() * (i + 1));
        const j2 = Math.floor(Math.random() * (i + 1));
        const j3 = Math.floor(Math.random() * (i + 1));
        [shuffledIndices1[i], shuffledIndices1[j1]] = [shuffledIndices1[j1], shuffledIndices1[i]];
        [shuffledIndices2[i], shuffledIndices2[j2]] = [shuffledIndices2[j2], shuffledIndices2[i]];
        [shuffledIndices3[i], shuffledIndices3[j3]] = [shuffledIndices3[j3], shuffledIndices3[i]];
      }

      spans.forEach((span, index) => {
        if (span.textContent !== '\u00A0') {
          const targetIndex1 = shuffledIndices1[index];
          const targetIndex2 = shuffledIndices2[index];
          const targetIndex3 = shuffledIndices3[index];
          const offset1 = positions[targetIndex1] - positions[index];
          const offset2 = positions[targetIndex2] - positions[index];
          const offset3 = positions[targetIndex3] - positions[index];

          span.style.setProperty('--shuffle-offset-1', `${offset1}px`);
          span.style.setProperty('--shuffle-offset-2', `${offset2}px`);
          span.style.setProperty('--shuffle-offset-3', `${offset3}px`);

          span.classList.add(
            'animate-matrix-flip',
            'animate-flicker',
            'animate-shuffle-position',
            `animation-delay-${(index % 13) + 1}`
          );
        }
      });

      setTimeout(() => {
        container.classList.remove('active');
        spans.forEach((span) => {
          span.classList.remove(
            'animate-matrix-flip',
            'animate-flicker',
            'animate-shuffle-position',
            ...Array.from(span.classList).filter((c) => c.startsWith('animation-delay-'))
          );
          span.style.removeProperty('--shuffle-offset-1');
          span.style.removeProperty('--shuffle-offset-2');
          span.style.removeProperty('--shuffle-offset-3');
        });
      }, 400);
    }
  };

  const renderMatrixText = (text) => {
    return text.split('').map((char, index) => (
      <span
        key={index}
        className={`inline-block transform-style-3d transition-transform-opacity duration-300 ease-in-out ${
          char === ' ' ? '' : `animation-delay-${(index % 13) + 1}`
        }`}
      >
        {char === ' ' ? '\u00A0' : char}
      </span>
    ));
  };

  return (
    <span
      onMouseEnter={handleMouseEnter}
      className="group inline-block perspective-1000"
    >
      <span className={`matrix-text inline-block`}>
        {renderMatrixText(text)}
      </span>
    </span>
  );
}