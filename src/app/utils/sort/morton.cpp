#include "morton.hpp"

namespace NugieApp {
  // "Insert" a 0 bit after each of the 16 low bits of x
  uint32_t part1By1(uint32_t x) {
    x &= 0x0000ffff;                  // x = ---- ---- ---- ---- fedc ba98 7654 3210
    x = (x ^ (x <<  8)) & 0x00ff00ff; // x = ---- ---- fedc ba98 ---- ---- 7654 3210
    x = (x ^ (x <<  4)) & 0x0f0f0f0f; // x = ---- fedc ---- ba98 ---- 7654 ---- 3210
    x = (x ^ (x <<  2)) & 0x33333333; // x = --fe --dc --ba --98 --76 --54 --32 --10
    x = (x ^ (x <<  1)) & 0x55555555; // x = -f-e -d-c -b-a -9-8 -7-6 -5-4 -3-2 -1-0
    return x;
  }

  // "Insert" two 0 bits after each of the 10 low bits of x
  uint32_t part1By2(uint32_t x) {
    x &= 0x000003ff;                  // x = ---- ---- ---- ---- ---- --98 7654 3210
    x = (x ^ (x << 16)) & 0xff0000ff; // x = ---- --98 ---- ---- ---- ---- 7654 3210
    x = (x ^ (x <<  8)) & 0x0300f00f; // x = ---- --98 ---- ---- 7654 ---- ---- 3210
    x = (x ^ (x <<  4)) & 0x030c30c3; // x = ---- --98 ---- 76-- --54 ---- 32-- --10
    x = (x ^ (x <<  2)) & 0x09249249; // x = ---- 9--8 --7- -6-- 5--4 --3- -2-- 1--0
    return x;
  }

  uint32_t encodeMorton(uint32_t x, uint32_t y) {
    return (part1By1(y) << 1) + part1By1(x);
  }

  uint32_t encodeMorton(uint32_t x, uint32_t y, uint32_t z) {
    return (part1By2(z) << 2) + (part1By2(y) << 1) + part1By2(x);
  }

  bool mortonComparator(IndirectSamplerData a, IndirectSamplerData b) {
    uint32_t aValue = encodeMorton(a.xCoord, a.yCoord);
    uint32_t bValue = encodeMorton(b.xCoord, b.yCoord);

    return aValue < bValue;
  }

  std::shared_ptr<std::vector<IndirectSamplerData>> sortPixelByMorton(uint32_t width, uint32_t height) {
    auto pixels = std::make_shared<std::vector<IndirectSamplerData>>();

    Ray newRay{};

    for (uint32_t i = 0; i < width; i++) {
      for (uint32_t j = 0; j < height; j++) {
        IndirectSamplerData pixel{ i, j, 0u, newRay };
        pixels->emplace_back(pixel);
      }
    }

    std::sort(pixels->begin(), pixels->end(), mortonComparator);
    return pixels;
  }
}


