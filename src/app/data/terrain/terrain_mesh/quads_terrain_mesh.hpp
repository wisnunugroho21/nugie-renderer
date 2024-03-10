#pragma once

#include <array>

#include "terrain_mesh.hpp"
#include "../terrain_point/terrain_points.hpp"
#include "../../../general_struct.hpp"

namespace NugieApp {
  struct QuadTerrainMesh : public TerrainMesh {
    public:
      std::vector<Patch> getPatches() { return this->patches; }
      
      void convertPointsToMeshes(TerrainPoints* terrainPoints, float worldScale = 1.0f) override;
      void convertPointsToMeshes(TerrainPoints* terrainPoints, uint32_t patchSize = 32, float worldScale = 1.0f);

    private:
      std::vector<Patch> patches;
  };
}