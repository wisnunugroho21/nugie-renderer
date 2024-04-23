#pragma once

#include "../terrain_point/terrain_points.hpp"
#include "../../../general_struct.hpp"

namespace NugieApp {
  class TerrainGeneration { 
    public:
      TerrainGeneration();
      TerrainGeneration(const char* filePath);

      TerrainPoints* getTerrainPoints() { return this->terrainPoints; }

    protected:
      TerrainPoints* terrainPoints = nullptr;

    private:
      void generateTerrainPoints(const char* filePath);
  };
}