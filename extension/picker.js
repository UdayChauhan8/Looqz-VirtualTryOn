// picker.js

window.looqzPicker = {
  activate: activatePickerMode,
  deactivate: deactivatePickerMode,
  autoDetect: autoDetectProductImage
};

function autoDetectProductImage() {
  const images = Array.from(document.querySelectorAll('img'))
    .filter(img => {
      const rect = img.getBoundingClientRect();
      const src = (img.currentSrc || img.src || '').toLowerCase();
      return rect.width > 200 && rect.height > 200
          && src
          && !src.includes('logo')
          && !src.includes('icon')
          && !src.includes('banner');
    })
    .sort((a, b) => {
      // Sort by area descending — biggest visible image wins
      const aArea = a.getBoundingClientRect().width * a.getBoundingClientRect().height;
      const bArea = b.getBoundingClientRect().width * b.getBoundingClientRect().height;
      return bArea - aArea;
    });

  return images.length > 0 ? (images[0].currentSrc || images[0].src) : null;
}

function activatePickerMode() {
  const STATE = window.looqzState || {};
  STATE.isPickerActive = true;
  document.body.classList.add('looqz-picker-active');

  // Inject floating tooltip
  const tooltip = document.createElement('div');
  tooltip.id = 'looqz-picker-tooltip';
  tooltip.textContent = '🖱 Click any product image • Esc to cancel';
  document.body.appendChild(tooltip);

  // Highlight qualifying images on hover
  document.querySelectorAll('img').forEach(img => {
    const rect = img.getBoundingClientRect();
    if (rect.width > 100 && rect.height > 100) {
      img.classList.add('looqz-pickable');
      img.addEventListener('mouseenter', onImgHover);
      img.addEventListener('mouseleave', onImgLeave);
      img.addEventListener('click', onImgClick, { once: true });
    }
  });

  // Esc key to cancel
  document.addEventListener('keydown', onPickerEscape);
}

function onImgHover(e) {
  e.target.classList.add('looqz-img-hover');
}

function onImgLeave(e) {
  e.target.classList.remove('looqz-img-hover');
}

function onImgClick(e) {
  e.preventDefault();
  e.stopPropagation();
  const selectedUrl = e.target.currentSrc || e.target.src;
  deactivatePickerMode();
  
  // Send selected URL back to content.js state
  document.dispatchEvent(new CustomEvent('looqz-image-selected', {
    detail: { url: selectedUrl }
  }));
}

function onPickerEscape(e) {
  if (e.key === 'Escape') {
    deactivatePickerMode();
  }
}

function deactivatePickerMode() {
  const STATE = window.looqzState || {};
  STATE.isPickerActive = false;
  document.body.classList.remove('looqz-picker-active');
  const tooltip = document.getElementById('looqz-picker-tooltip');
  if (tooltip) tooltip.remove();
  
  document.querySelectorAll('.looqz-pickable').forEach(img => {
    img.classList.remove('looqz-pickable', 'looqz-img-hover');
    img.removeEventListener('mouseenter', onImgHover);
    img.removeEventListener('mouseleave', onImgLeave);
    img.removeEventListener('click', onImgClick);
  });
  document.removeEventListener('keydown', onPickerEscape);
}
