#include "descriptor_writer.hpp"
 
// std
#include <cassert>
#include <stdexcept>
 
namespace NugieVulkan {
  // *************** Descriptor Writer *********************
  
  DescriptorWriter::DescriptorWriter(Device* device, DescriptorSetLayout *setLayout, DescriptorPool *pool) 
    : device{device}, setLayout{setLayout}, pool{pool} 
  {
    
  }
  
  DescriptorWriter& DescriptorWriter::writeBuffer(uint32_t binding, VkDescriptorBufferInfo bufferInfo) {
    assert(this->setLayout->getBindings().count(binding) == 1 && "Layout does not contain specified binding");
  
    auto bindingDescription = this->setLayout->getBindings()[binding];
    
    VkWriteDescriptorSet write{};
    write.sType = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
    write.descriptorType = bindingDescription.descriptorType;
    write.dstBinding = binding;
    write.pBufferInfo = &bufferInfo;
    write.descriptorCount = 1u;
  
    writes.push_back(write);
    return *this;
  }
  
  DescriptorWriter& DescriptorWriter::writeImage(uint32_t binding, VkDescriptorImageInfo imageInfo) {
    assert(this->setLayout->getBindings().count(binding) == 1 && "Layout does not contain specified binding");
  
    auto bindingDescription = this->setLayout->getBindings()[binding];
    
    VkWriteDescriptorSet write{};
    write.sType = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
    write.descriptorType = bindingDescription.descriptorType;
    write.dstBinding = binding;
    write.pImageInfo = &imageInfo;
    write.descriptorCount = 1u;
  
    writes.push_back(write);
    return *this;
  }

  DescriptorWriter& DescriptorWriter::writeImage(uint32_t binding, std::vector<VkDescriptorImageInfo> &imageInfos) {
    assert(this->setLayout->getBindings().count(binding) == 1 && "Layout does not contain specified binding");
  
    auto bindingDescription = this->setLayout->getBindings()[binding];
    
    VkWriteDescriptorSet write{};
    write.sType = VK_STRUCTURE_TYPE_WRITE_DESCRIPTOR_SET;
    write.descriptorType = bindingDescription.descriptorType;
    write.dstBinding = binding;
    write.pImageInfo = imageInfos.data();
    write.descriptorCount = static_cast<uint32_t>(imageInfos.size());
  
    writes.push_back(write);
    return *this;
  }
  
  bool DescriptorWriter::build(VkDescriptorSet *set) {
    bool success = this->pool->allocate(this->setLayout->getDescriptorSetLayout(), set);
    if (!success) {
      return false;
    }

    this->overwrite(set);
    return true;
  }
  
  void DescriptorWriter::overwrite(VkDescriptorSet *set) {
    for (auto &write : this->writes) {
      write.dstSet = *set;
    }
    
    vkUpdateDescriptorSets(this->device->getLogicalDevice(), static_cast<uint32_t>(this->writes.size()), this->writes.data(), 0, nullptr);
  }
}  // namespace lve