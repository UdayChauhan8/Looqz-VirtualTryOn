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

let pickerMoveHandler = null;
let pickerClickHandler = null;
let pickerEscapeHandler = null;
let currentlyHoveredImg = null;

function activatePickerMode() {
  const STATE = window.looqzState || {};
  if (STATE.isPickerActive) return;
  STATE.isPickerActive = true;
  document.body.classList.add('looqz-picker-active');

  let tooltip = document.getElementById('looqz-picker-tooltip');
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.id = 'looqz-picker-tooltip';
    tooltip.textContent = '🖱 Click any product image • Esc to cancel';
    document.body.appendChild(tooltip);
  }

  pickerMoveHandler = function(e) {
    if (!STATE.isPickerActive) return;
    const elements = document.elementsFromPoint(e.clientX, e.clientY);
    let targetImg = null;
    
    for (const el of elements) {
      if (el.id === 'looqz-sidebar' || el.id === 'looqz-picker-tooltip' || el.closest('#looqz-sidebar')) {
          break; // Stop processing if over extension UI
      }
      if (el.tagName && el.tagName.toLowerCase() === 'img') {
        const rect = el.getBoundingClientRect();
        if (rect.width > 50 && rect.height > 50) {
          targetImg = el;
          break;
        }
      } else if (el.tagName) {
         try {
             const style = window.getComputedStyle(el);
             if (style.backgroundImage && style.backgroundImage !== 'none' && style.backgroundImage.startsWith('url(')) {
                 const rect = el.getBoundingClientRect();
                 if (rect.width > 100 && rect.height > 100) {
                     targetImg = el;
                     break;
                 }
             }
         } catch(err) {}
      }
    }

    if (currentlyHoveredImg !== targetImg) {
      if (currentlyHoveredImg) {
        currentlyHoveredImg.classList.remove('looqz-img-hover');
      }
      if (targetImg) {
        targetImg.classList.add('looqz-img-hover');
      }
      currentlyHoveredImg = targetImg;
    }
  };

  pickerClickHandler = function(e) {
    if (!STATE.isPickerActive) return;
    if (!currentlyHoveredImg) return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    let selectedUrl = '';
    if (currentlyHoveredImg.tagName.toLowerCase() === 'img') {
       selectedUrl = currentlyHoveredImg.currentSrc || currentlyHoveredImg.src;
    } else {
       const style = window.getComputedStyle(currentlyHoveredImg);
       const match = style.backgroundImage.match(/^url\(['"]?(.*?)['"]?\)$/);
       if (match && match[1]) {
           selectedUrl = match[1].replace(/['"]/g, '');
       }
    }

    deactivatePickerMode();
    
    if (selectedUrl) {
      document.dispatchEvent(new CustomEvent('looqz-image-selected', {
        detail: { url: selectedUrl }
      }));
    }
  };

  pickerEscapeHandler = function(e) {
    if (e.key === 'Escape') {
      deactivatePickerMode();
    }
  };

  document.addEventListener('mousemove', pickerMoveHandler, true);
  document.addEventListener('click', pickerClickHandler, true);
  document.addEventListener('keydown', pickerEscapeHandler, true);
}

function deactivatePickerMode() {
  const STATE = window.looqzState || {};
  STATE.isPickerActive = false;
  document.body.classList.remove('looqz-picker-active');
  const tooltip = document.getElementById('looqz-picker-tooltip');
  if (tooltip) tooltip.remove();
  
  if (currentlyHoveredImg) {
    currentlyHoveredImg.classList.remove('looqz-img-hover');
    currentlyHoveredImg = null;
  }

  if (pickerMoveHandler) {
    document.removeEventListener('mousemove', pickerMoveHandler, true);
    pickerMoveHandler = null;
  }
  if (pickerClickHandler) {
    document.removeEventListener('click', pickerClickHandler, true);
    pickerClickHandler = null;
  }
  if (pickerEscapeHandler) {
    document.removeEventListener('keydown', pickerEscapeHandler, true);
    pickerEscapeHandler = null;
  }

  document.querySelectorAll('.looqz-img-hover').forEach(img => {
    img.classList.remove('looqz-img-hover');
  });
}
