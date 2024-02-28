#pragma once

#include "../../../general_struct.hpp"

namespace NugieApp {
  struct TerrainMesh {
    std::vector<Position> positions;
    std::vector<uint32_t> indices;

    public:
      static TerrainMesh convertPointsToMeshes(std::vector<float> terrainPoints);
  };
}