// SPDX-License-Identifier: MIT
//! Color and look as one colour transform. A look and the four sliders are each a linear map of
//! the red, green and blue values (0 to 1, as stored), so together they make one 3 × 3 matrix and
//! an offset, clamped once at the end. The editor previews exactly this map with an SVG colour
//! matrix on the picture (src/editors/picture.ts holds the same numbers); FFmpeg applies it as a
//! 3D LUT (`lut3d`) that the job writes from the same map.

use std::fmt::Write;

use crate::media::{Grade, Look};

/// How far each slider reaches at ±100.
const BRIGHTNESS: f64 = 0.5;
const CONTRAST: f64 = 0.5;
const WARMTH: [f64; 3] = [0.14, 0.03, -0.16];

/// The luma weights of the saturation matrix, as the Filter Effects specification uses them.
const LUMA: [f64; 3] = [0.213, 0.715, 0.072];
const SEPIA: [[f64; 3]; 3] = [
    [0.393, 0.769, 0.189],
    [0.349, 0.686, 0.168],
    [0.272, 0.534, 0.131],
];

/// The side of the LUT: 33 points per channel is the usual size, smooth for any linear map.
pub(super) const LUT_SIDE: usize = 33;

/// `out = matrix · rgb + offset`, clamped to 0…1.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) struct ColorMap {
    pub matrix: [[f64; 3]; 3],
    pub offset: [f64; 3],
}

impl ColorMap {
    const IDENTITY: ColorMap = ColorMap {
        matrix: [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
        offset: [0.0; 3],
    };

    /// The look first, then brightness, contrast, saturation and warmth.
    pub fn of(look: Look, grade: Grade) -> ColorMap {
        let slider = |value: f64| {
            if value.is_finite() {
                value.clamp(-100.0, 100.0) / 100.0
            } else {
                0.0
            }
        };
        let mut steps = look_steps(look);
        steps.extend([
            Step::Brightness(1.0 + BRIGHTNESS * slider(grade.brightness)),
            Step::Contrast(1.0 + CONTRAST * slider(grade.contrast)),
            Step::Saturation(1.0 + slider(grade.saturation)),
            Step::Warmth(slider(grade.warmth)),
        ]);
        steps
            .into_iter()
            .fold(ColorMap::IDENTITY, |map, step| step.map().after(&map))
    }

    /// Whether the map leaves every colour as it is (to the LUT's precision).
    pub fn is_identity(&self) -> bool {
        let close = |a: f64, b: f64| (a - b).abs() < 1e-4;
        (0..3).all(|i| {
            close(self.offset[i], 0.0)
                && (0..3).all(|j| close(self.matrix[i][j], Self::IDENTITY.matrix[i][j]))
        })
    }

    /// This map applied after `first`.
    fn after(&self, first: &ColorMap) -> ColorMap {
        let row = |i: usize, column: [f64; 3]| -> f64 {
            (0..3).map(|k| self.matrix[i][k] * column[k]).sum()
        };
        let column = |j: usize| [0, 1, 2].map(|k| first.matrix[k][j]);
        ColorMap {
            matrix: [0, 1, 2].map(|i| [0, 1, 2].map(|j| row(i, column(j)))),
            offset: [0, 1, 2].map(|i| row(i, first.offset) + self.offset[i]),
        }
    }

    pub fn apply(&self, rgb: [f64; 3]) -> [f64; 3] {
        let mut out = [0.0; 3];
        for (i, value) in out.iter_mut().enumerate() {
            let sum: f64 = (0..3).map(|j| self.matrix[i][j] * rgb[j]).sum();
            *value = (sum + self.offset[i]).clamp(0.0, 1.0);
        }
        out
    }

    /// The map as a `.cube` 3D LUT of `side` points per channel, red changing fastest.
    pub fn cube(&self, side: usize) -> String {
        let side = side.max(2);
        let mut text = format!("LUT_3D_SIZE {side}\n");
        let at = |i: usize| i as f64 / (side - 1) as f64;
        for b in 0..side {
            for g in 0..side {
                for r in 0..side {
                    let [x, y, z] = self.apply([at(r), at(g), at(b)]);
                    let _ = writeln!(text, "{x:.6} {y:.6} {z:.6}");
                }
            }
        }
        text
    }
}

#[derive(Debug, Clone, Copy)]
enum Step {
    /// Every channel times this.
    Brightness(f64),
    /// Away from or towards the middle grey.
    Contrast(f64),
    /// 0 is grey, 1 leaves it, 2 doubles it.
    Saturation(f64),
    /// -1 (cool) to 1 (warm): more red and less blue, or the other way.
    Warmth(f64),
    /// 0 to 1 of the classic sepia tone.
    Sepia(f64),
    /// Blacks lifted to this and whites lowered by half as much: a washed-out print.
    Fade(f64),
}

impl Step {
    fn map(self) -> ColorMap {
        let diagonal = |gains: [f64; 3], offset: f64| ColorMap {
            matrix: [
                [gains[0], 0.0, 0.0],
                [0.0, gains[1], 0.0],
                [0.0, 0.0, gains[2]],
            ],
            offset: [offset; 3],
        };
        match self {
            Step::Brightness(gain) => diagonal([gain; 3], 0.0),
            Step::Contrast(gain) => diagonal([gain; 3], 0.5 * (1.0 - gain)),
            Step::Saturation(amount) => {
                let mut matrix = [[0.0; 3]; 3];
                for (i, row) in matrix.iter_mut().enumerate() {
                    for (j, cell) in row.iter_mut().enumerate() {
                        let same = if i == j { 1.0 } else { 0.0 };
                        *cell = LUMA[j] * (1.0 - amount) + same * amount;
                    }
                }
                ColorMap {
                    matrix,
                    offset: [0.0; 3],
                }
            }
            Step::Warmth(amount) => diagonal(
                [
                    1.0 + WARMTH[0] * amount,
                    1.0 + WARMTH[1] * amount,
                    1.0 + WARMTH[2] * amount,
                ],
                0.0,
            ),
            Step::Sepia(amount) => {
                let mut matrix = [[0.0; 3]; 3];
                for (i, row) in matrix.iter_mut().enumerate() {
                    for (j, cell) in row.iter_mut().enumerate() {
                        let same = if i == j { 1.0 } else { 0.0 };
                        *cell = SEPIA[i][j] * amount + same * (1.0 - amount);
                    }
                }
                ColorMap {
                    matrix,
                    offset: [0.0; 3],
                }
            }
            Step::Fade(lift) => diagonal([1.0 - 1.5 * lift; 3], lift),
        }
    }
}

/// The ready-made looks, in the steps the sliders also use.
fn look_steps(look: Look) -> Vec<Step> {
    match look {
        Look::None => vec![],
        Look::BlackWhite => vec![Step::Saturation(0.0), Step::Contrast(1.1)],
        Look::Warm => vec![Step::Warmth(0.6), Step::Saturation(1.08)],
        Look::Cool => vec![Step::Warmth(-0.6), Step::Contrast(1.04)],
        Look::Vivid => vec![Step::Saturation(1.45), Step::Contrast(1.12)],
        Look::Faded => vec![Step::Saturation(0.7), Step::Fade(0.12)],
        Look::Vintage => vec![
            Step::Sepia(0.4),
            Step::Fade(0.08),
            Step::Warmth(0.25),
            Step::Contrast(0.95),
        ],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FLAT: Grade = Grade {
        brightness: 0.0,
        contrast: 0.0,
        saturation: 0.0,
        warmth: 0.0,
    };

    fn near(actual: [f64; 3], expected: [f64; 3]) {
        for i in 0..3 {
            assert!(
                (actual[i] - expected[i]).abs() < 1e-3,
                "{actual:?} is not {expected:?}"
            );
        }
    }

    #[test]
    fn nothing_chosen_changes_nothing() {
        assert!(ColorMap::of(Look::None, FLAT).is_identity());
        assert!(!ColorMap::of(Look::Warm, FLAT).is_identity());
        let nonsense = Grade {
            brightness: f64::NAN,
            ..FLAT
        };
        assert!(ColorMap::of(Look::None, nonsense).is_identity());
    }

    #[test]
    fn black_and_white_has_no_colour() {
        let map = ColorMap::of(Look::BlackWhite, FLAT);
        let [r, g, b] = map.apply([0.9, 0.2, 0.1]);
        assert!((r - g).abs() < 1e-9 && (g - b).abs() < 1e-9);
        // Grey stays grey; the contrast pivots on the middle.
        near(map.apply([0.5; 3]), [0.5; 3]);
    }

    #[test]
    fn sliders_reach_their_ends() {
        let grade = |brightness, contrast, saturation, warmth| Grade {
            brightness,
            contrast,
            saturation,
            warmth,
        };
        near(
            ColorMap::of(Look::None, grade(100.0, 0.0, 0.0, 0.0)).apply([0.4; 3]),
            [0.6; 3],
        );
        near(
            ColorMap::of(Look::None, grade(-100.0, 0.0, 0.0, 0.0)).apply([0.4; 3]),
            [0.2; 3],
        );
        near(
            ColorMap::of(Look::None, grade(0.0, 100.0, 0.0, 0.0)).apply([0.3; 3]),
            [0.2; 3],
        );
        near(
            ColorMap::of(Look::None, grade(0.0, 0.0, 0.0, 100.0)).apply([0.5; 3]),
            [0.57, 0.515, 0.42],
        );
        // Values past 100 are taken as 100, and the result stays inside 0…1.
        near(
            ColorMap::of(Look::None, grade(500.0, 0.0, 0.0, 0.0)).apply([0.9; 3]),
            [1.0; 3],
        );
    }

    /// The same numbers as the page's test of `colorMap` (src/editors/picture.test.tsx).
    #[test]
    fn matches_the_editors_preview() {
        let map = ColorMap::of(
            Look::Vintage,
            Grade {
                brightness: 20.0,
                contrast: -10.0,
                saturation: 30.0,
                warmth: -40.0,
            },
        );
        near(map.apply([0.2, 0.5, 0.8]), [0.4087, 0.5868, 0.7496]);
        near(map.apply([1.0, 0.0, 0.0]), [0.8986, 0.2161, 0.1838]);
    }

    #[test]
    fn writes_a_cube_with_red_changing_fastest() {
        let map = ColorMap::of(Look::None, FLAT);
        let cube = map.cube(2);
        let lines: Vec<&str> = cube.lines().collect();
        assert_eq!(lines[0], "LUT_3D_SIZE 2");
        assert_eq!(lines.len(), 9);
        assert_eq!(lines[1], "0.000000 0.000000 0.000000");
        assert_eq!(lines[2], "1.000000 0.000000 0.000000");
        assert_eq!(lines[3], "0.000000 1.000000 0.000000");
        assert_eq!(lines[8], "1.000000 1.000000 1.000000");
        assert_eq!(map.cube(LUT_SIDE).lines().count(), LUT_SIDE.pow(3) + 1);
    }
}
