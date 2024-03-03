#include "terrain_points.hpp"

namespace NugieApp {
  TerrainPoints::TerrainPoints(uint32_t size) : size{size} {
    for (int i = 0; i < this->size * this->size; i++) {
      this->points.emplace_back(0.0f);
    }
  }

  TerrainPoints::TerrainPoints(uint32_t size, float initialValue) : size{size} {
    for (int i = 0; i < this->size * this->size; i++) {
      this->points.emplace_back(initialValue);
    }
  }

  std::vector<float> TerrainPoints::getAll() { 
    return this->points; 
  }

  float TerrainPoints::get(int x, int z) { 
    return this->points[x + this->size * z];  
  }

  float TerrainPoints::get(uint32_t index) { 
    return this->points[index];  
  }

  void TerrainPoints::set(int x, int z, float height) {
    this->points[x + this->size * z] = height;
  }

  void TerrainPoints::set(uint32_t index, float height) {
    this->points[index] = height;
  }

  float TerrainPoints::getMin() {
    float min = 99999.0f;

    for (auto &&point : this->points) {
      if (point < min) min = point;
    }

    return min;    
  }

  float TerrainPoints::getMax() {
    float max = -99999.0f;

    for (auto &&point : this->points) {
      if (point > max) max = point;
    }

    return max;
  }

  void TerrainPoints::normalize(float minRange, float maxRange) {
    float min = this->getMin();
    float max = this->getMax();

    if (max <= min) return;

    float minMaxDelta = max - min;
    float minMaxRange = maxRange - minRange;

    for (size_t i = 0; i < this->points.size(); i++) {
      this->points[i] = ((this->points[i] - min) / minMaxDelta) * minMaxRange + minRange;
    }
    

    /* for (auto &&point : this->points) {
      point = ((point - min) / minMaxDelta) * minMaxRange + minRange;      
    } */    
  }
}