#pragma once

#include "terrain_mesh.hpp"
#include "../terrain_point/terrain_points.hpp"
#include "../../../general_struct.hpp"

namespace NugieApp {
  class PatchedTerrainMesh : public TerrainMesh {
    public:
      PatchedTerrainMesh(TerrainPoints* terrainPoints, float worldScale = 1.0f, uint32_t patchSize = 3u);
      
      static bool canTerrainBePatched(uint32_t terrainSize, uint32_t patchSize);
    
    protected:
      uint32_t patchSize = 3u;

      void generateIndices(TerrainPoints* terrainPoints) override;
      void generatePatchIndices(TerrainPoints* terrainPoints, uint32_t curX, uint32_t curZ);

  };
}