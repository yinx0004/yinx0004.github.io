// The sliced cover animation leaves the post title centred in a header that is as tall
// as the viewport, while the content is pulled up by a width-based margin. On tall
// screens that leaves a large empty gap between the byline and the content. Once the
// cover has slid away (.modify), place the content a fixed distance below the title.
(function () {
  var container = document.getElementById('notepad-post-container');
  if (!container || !container.classList.contains('intro-effect-sliced')) return;
  var title = container.querySelector('.notepad-post-title');
  var content = container.querySelector('.notepad-post-content > div');
  if (!title || !content) return;

  var GAP = 24; // px between the byline block and the content

  function docTop(el) { // layout position, ignoring CSS transforms
    var y = 0;
    for (; el; el = el.offsetParent) y += el.offsetTop;
    return y;
  }

  function fit() {
    if (!container.classList.contains('modify')) return;
    content.style.marginTop = '';
    var titleBottom = title.getBoundingClientRect().bottom + window.pageYOffset;
    var margin = parseFloat(getComputedStyle(content).marginTop) || 0;
    content.style.marginTop = (margin + titleBottom + GAP - docTop(content)) + 'px';
  }

  // Measure once the title has finished scaling up; the timeout is a fallback for
  // browsers that skip the transition (about 0.9s after .modify is added).
  function fitLater() { setTimeout(fit, 1000); }
  title.addEventListener('transitionend', function (e) {
    if (e.target === title && e.propertyName.indexOf('transform') !== -1) fit();
  });
  new MutationObserver(fitLater).observe(container, { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('resize', fit);
  window.addEventListener('load', fitLater);
})();
