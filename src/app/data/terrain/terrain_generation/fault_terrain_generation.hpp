#pragma once

#include "terrain_generation.hpp"
#include "../terrain_point/terrain_points.hpp"
#include "../../../general_struct.hpp"

namespace NugieApp {
  class FaultTerrainGeneration : public TerrainGeneration { 
    public:
      FaultTerrainGeneration(uint32_t terrainSize, uint32_t iterations, float minHeight, float maxHeight, float filter);

    private:
      void generateTerrainPoints(uint32_t terrainSize, uint32_t iterations, float minHeight, float maxHeight, float filter);

      void createFaultFormationInternal(uint32_t iterations, float minHeight, float maxHeight, float filter);
      void genRandomTerrainPoints(int* x1, int* x2, int* z1, int* z2);
      void applyFIRFilter(float filter);
      float firFilterSinglePoint(int x, int z, float prevFractalVal, float filter);
  };
}