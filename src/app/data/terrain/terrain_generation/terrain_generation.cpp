#include "terrain_generation.hpp"

#include "../../../utils/load_file/load_file.hpp"

namespace NugieApp {
  TerrainGeneration::TerrainGeneration(const char* filePath) : filePath{filePath} {}

  std::vector<float> TerrainGeneration::generateTerrainPoints() {
    std::vector<float> terrainPoints;
		int fileSize = 0;

    float* f = (float*) ReadBinaryFile(filePath, &fileSize);
		int terrainSize = static_cast<int>(sqrtf(static_cast<float>(fileSize) / sizeof(float)));

		for (int z = 0; z < terrainSize; z++) {
			for (int x = 0; x < terrainSize; x++) {
        terrainPoints.emplace_back(f[x + terrainSize * z]);
			}
		}

    return terrainPoints;
  }
}