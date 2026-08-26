from __future__ import annotations

import cv2
import numpy as np


class MotionDetector:
    """Low-cost background subtraction used before every AI inference."""

    def __init__(self, minimum_area: int) -> None:
        self.minimum_area = minimum_area
        self.subtractor = cv2.createBackgroundSubtractorMOG2(
            history=250, varThreshold=30, detectShadows=False
        )

    def has_activity(self, frame: np.ndarray) -> bool:
        small = cv2.resize(frame, (320, 240))
        gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
        gray = cv2.GaussianBlur(gray, (5, 5), 0)
        mask = self.subtractor.apply(gray)
        _, mask = cv2.threshold(mask, 200, 255, cv2.THRESH_BINARY)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        # Areas are calculated after downsizing; scale the configured full-frame area.
        scaled_threshold = max(100, self.minimum_area * (320 / frame.shape[1]) * (240 / frame.shape[0]))
        return any(cv2.contourArea(contour) >= scaled_threshold for contour in contours)
