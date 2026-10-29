Visual engine eval
==================
clean       pages 10  findings  0  expected  0  detected  0  IoU>=0.7  0  meanIoU 0  77.38 ms/page
violations  pages 10  findings  7  expected  7  detected  7  IoU>=0.7  7  meanIoU 0.918  67.76 ms/page

Per violation
  violations p 2  VIS-LOGO-MARGIN      FOUND  IoU 0.91  0.3% of page width from the left edge
  violations p 3  VIS-LOGO-CLEARSPACE  FOUND  IoU 0.95  0.16x logo height (right side)
  violations p 4  VIS-PALETTE          FOUND  IoU 1.00  #FF2E93 is ΔE 65.6 from the nearest palette colour #B4643C (6.6% of the page)
  violations p 5  VIS-TYPE-FAMILY      FOUND  IoU 0.71  3 text item(s) set in serif
  violations p 6  VIS-DENSITY          FOUND  IoU 0.86  64.7% of the page is covered
  violations p 7  VIS-TYPE-SIZE        FOUND  IoU 1.00  median body size 24.0pt across 4 items
  violations p10  VIS-LOGO-PRESENT     FOUND  IoU 1.00  logo not detected (best correlation below 0.35)

  [PASS] Every injected logo/margin/clear-space and palette violation found
  [PASS] Those violations have IoU >= 0.70
  [PASS] Clean deck produces zero visual findings
  [PASS] No unexpected findings on the violations deck pages
  [PASS] Density points at the dense region (IoU >= 0.70)
