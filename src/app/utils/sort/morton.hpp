#pragma once

#include "../../general_struct.hpp"

#include <vector>
#include <memory>
#include <algorithm>

namespace NugieApp {
  uint32_t part1By1(uint32_t x);
  uint32_t part1By2(uint32_t x);

  uint32_t encodeMorton(uint32_t x, uint32_t y);
  uint32_t encodeMorton(uint32_t x, uint32_t y, uint32_t z);

  bool mortonComparator(IndirectSamplerData a, IndirectSamplerData b);

  std::shared_ptr<std::vector<IndirectSamplerData>> sortPixelByMorton(uint32_t width, uint32_t height);
  
} // namespace name

