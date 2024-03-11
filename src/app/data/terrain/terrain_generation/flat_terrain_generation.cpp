#include "flat_terrain_generation.hpp"

#include "../../../utils/load_file/load_file.hpp"

namespace NugieApp {  
  FlatTerrainGeneration::FlatTerrainGeneration(uint32_t terrainSize, float terrainHeight) {
    this->generateTerrainPoints(terrainSize, terrainHeight);
  }

  void FlatTerrainGeneration::generateTerrainPoints(uint32_t terrainSize, float terrainHeight) {
		int fileSize = 0;

    if (this->terrainPoints == nullptr) {
      this->terrainPoints = new TerrainPoints(terrainSize);
    } 
    
    else if (this->terrainPoints->getSize() < terrainSize) {
      delete this->terrainPoints;
      this->terrainPoints = new TerrainPoints(terrainSize);
    }
    
		for (int z = 0; z < terrainSize; z++) {
			for (int x = 0; x < terrainSize; x++) {
        this->terrainPoints->set(x, z, terrainHeight);
			}
		}
  }
}