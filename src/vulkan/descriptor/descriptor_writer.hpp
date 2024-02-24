#pragma once
 
#include "../device/device.hpp"
#include "descriptor_pool.hpp"
#include "descriptor_set_layout.hpp"
 
// std
#include <memory>
#include <unordered_map>
#include <vector>
 
namespace NugieVulkan {
  class DescriptorWriter {
  public:
    DescriptorWriter(Device* device, DescriptorSetLayout *setLayout, DescriptorPool *pool);
  
    DescriptorWriter& writeBuffer(uint32_t binding, const VkDescriptorBufferInfo &bufferInfo);
    
    DescriptorWriter& writeImage(uint32_t binding, const VkDescriptorImageInfo &imageInfo);
    DescriptorWriter& writeImage(uint32_t binding, const std::vector<VkDescriptorImageInfo> &imageInfos);

    DescriptorWriter& setVariableSetCounts(const std::vector<uint32_t> &variableSetCounts);

    DescriptorWriter& clear();
    bool build(VkDescriptorSet *set);
    void overwrite(VkDescriptorSet *set);
  
  private:
    Device* device;
    DescriptorSetLayout *setLayout = nullptr;
    DescriptorPool *pool = nullptr;
    
    std::vector<VkWriteDescriptorSet> writes;
    std::vector<uint32_t> variableSetCounts;
  };
}  // namespace lve