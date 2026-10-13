# Gallery lightbox layout regression

Run the local frontend with `npm run frontend`, then open
`http://127.0.0.1:5500/#artwork` in a browser.

1. Set the viewport to 320 × 568 CSS pixels.
2. Open illustration 10, a portrait image. Check that the complete caption,
   including `10 / 107`, is visible above both navigation buttons.
3. Switch to English and reopen illustration 10. Check the full English caption.
4. Repeat with viewports 667 × 375 and 1440 × 900. Open illustration 1 as well
   to cover a landscape image.
5. Close with Escape and confirm that keyboard focus returns to the gallery.

For each viewport, inspect the rendered bounding rectangles: the caption must
not intersect the close/previous/next buttons, and those buttons must remain
inside the viewport. A portrait image must retain its aspect ratio.

The original failure at 320 × 568 put the portrait caption at y=494–513.5 while
both navigation buttons occupied y=488–552; their edges covered the caption.
This is a browser layout regression, so source-string assertions alone do not
verify it.
