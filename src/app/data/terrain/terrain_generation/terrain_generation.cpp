#include "terrain_generation.hpp"

#include "../../../utils/load_file/load_file.hpp"

namespace NugieApp {
  TerrainGeneration::TerrainGeneration() {}
  
  TerrainGeneration::TerrainGeneration(const char* filePath) {
    this->generateTerrainPoints(filePath);
  }

  void TerrainGeneration::generateTerrainPoints(const char* filePath) {
		int fileSize = 0;

    float* f = (float*) ReadBinaryFile(filePath, &fileSize);
		uint32_t terrainSize = static_cast<uint32_t>(sqrtf(static_cast<float>(fileSize) / sizeof(float)));

    if (this->terrainPoints == nullptr) {
      this->terrainPoints = new TerrainPoints(terrainSize);
    }
    
		for (int z = 0; z < terrainSize; z++) {
			for (int x = 0; x < terrainSize; x++) {
        this->terrainPoints->set(x, z, f[x + terrainSize * z]);
			}
		}
  }
}