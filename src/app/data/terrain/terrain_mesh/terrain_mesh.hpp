#pragma once

#include "../terrain_point/terrain_points.hpp"
#include "../../../general_struct.hpp"

namespace NugieApp {
  struct TerrainMesh {
    std::vector<Vertex> vertices;
    std::vector<NormText> normTexts;
    std::vector<uint32_t> indices;

    public:
      static TerrainMesh convertPointsToMeshes(TerrainPoints* terrainPoints);
      static TerrainMesh convertPointsToMeshes(std::vector<float> terrainPoints);
  };
}