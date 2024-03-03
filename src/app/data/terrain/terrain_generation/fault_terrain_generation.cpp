#include "fault_terrain_generation.hpp"

#include "../../../utils/load_file/load_file.hpp"

namespace NugieApp {
  FaultTerrainGeneration::FaultTerrainGeneration(int terrainSize, int iterations, float minHeight, float maxHeight, float filter) {
    this->generateTerrainPoints(terrainSize, iterations, minHeight, maxHeight, filter);
  }

  void FaultTerrainGeneration::generateTerrainPoints(int terrainSize, int iterations, float minHeight, float maxHeight, float filter) {
    this->terrainPoints = new TerrainPoints(terrainSize);
    this->createFaultFormationInternal(iterations, minHeight, maxHeight, filter);
    this->terrainPoints->normalize(minHeight, maxHeight);
  }

  void FaultTerrainGeneration::createFaultFormationInternal(int iterations, float minHeight, float maxHeight, float filter) {
    float deltaHeight = maxHeight - minHeight;

    for (int curIter = 0; curIter < iterations; curIter++) {
      float iterationRatio = (static_cast<float>(curIter) / static_cast<float>(iterations));
      float height = maxHeight - iterationRatio * deltaHeight;

      int x1 = 0, x2 = 0, z1 = 0, z2 = 0;

      this->genRandomTerrainPoints(&x1, &x2, &z1, &z2);

      int dirX = x2 - x1;
      int dirZ = z2 - z1;

      for (int z = 0; z < this->terrainPoints->getSize(); z++) {
        for (int x = 0; x < this->terrainPoints->getSize(); x++) {
          int dirX_in = x - x1;
          int dirZ_in = z - z1;

          int crossProduct = dirX_in * dirZ - dirX * dirZ_in;

          if (crossProduct > 0) {
            float curHeight = this->terrainPoints->get(x, z);
            this->terrainPoints->set(x, z, curHeight + height);
          }
        }
      }        
    }
	
    this->applyFIRFilter(filter);
  }

  void FaultTerrainGeneration::genRandomTerrainPoints(int* x1, int* x2, int* z1, int* z2) {
    *x1 = rand() % this->terrainPoints->getSize();
    *z1 = rand() % this->terrainPoints->getSize();

    int counter = 0;

    do {
      *x2 = rand() % this->terrainPoints->getSize();
      *z2 = rand() % this->terrainPoints->getSize();

      if (counter++ == 1000) {
        printf("Endless loop detected in %s:%d\n", __FILE__, __LINE__);
        assert(0);
      }
    } while ((*x1 == *x2) && (*z1 == *z2));
  }

  void FaultTerrainGeneration::applyFIRFilter(float filter) {
    // left to right
    for (int z = 0; z < this->terrainPoints->getSize(); z++) {
      float prevVal = this->terrainPoints->get(0, z);
      for (int x = 1; x < this->terrainPoints->getSize(); x++) {
        prevVal = this->firFilterSinglePoint(x, z, prevVal, filter);
      }
    }

    // right to left
    for (int z = 0; z < this->terrainPoints->getSize(); z++) {
      float prevVal = this->terrainPoints->get(this->terrainPoints->getSize() - 1, z);
      for (int x = this->terrainPoints->getSize() - 2; x >= 0; x--) {
        prevVal = this->firFilterSinglePoint(x, z, prevVal, filter);
      }
    }

    // bottom to top
    for (int x = 0; x < this->terrainPoints->getSize(); x++) {
      float prevVal = this->terrainPoints->get(x, 0);
      for (int z = 1; z < this->terrainPoints->getSize(); z++) {
        prevVal = this->firFilterSinglePoint(x, z, prevVal, filter);
      }
    }

    // top to bottom
    for (int x = 0; x < this->terrainPoints->getSize(); x++) {
      float prevVal = this->terrainPoints->get(x, this->terrainPoints->getSize() - 1);
      for (int z = this->terrainPoints->getSize() - 2; z >= 0; z--) {
        prevVal = this->firFilterSinglePoint(x, z, prevVal, filter);
      }
    }
  }

  float FaultTerrainGeneration::firFilterSinglePoint(int x, int z, float prevVal, float filter) {
    float curVal = this->terrainPoints->get(x, z);
    float newVal = filter * prevVal + (1 - filter) * curVal;
    this->terrainPoints->set(x, z, newVal);
    
    return newVal;
  }
}