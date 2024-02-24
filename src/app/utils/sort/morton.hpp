#pragma once

#include "../../general_struct.hpp"

#include <vector>
#include <memory>
#include <algorithm>
#include <glm/glm.hpp>

namespace NugieApp {
  struct ScreenRayCoordMorton {
    glm::uvec2 coord;
    uint32_t morton;
  };

  uint32_t part1By1(uint32_t x);
  uint32_t part1By2(uint32_t x);

  uint32_t encodeMorton(uint32_t x, uint32_t y);
  uint32_t encodeMorton(uint32_t x, uint32_t y, uint32_t z);

  bool mortonComparator(ScreenRayCoordMorton a, ScreenRayCoordMorton b);

  std::vector<ScreenRayCoord> sortPixelByMorton(uint32_t width, uint32_t height);
  
} // namespace name

