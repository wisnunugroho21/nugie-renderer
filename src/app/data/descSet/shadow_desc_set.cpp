#include "shadow_desc_set.hpp"
#include "../../../vulkan/descriptor/descriptor_writer.hpp"

namespace NugieApp {
  ShadowDescSet::ShadowDescSet(NugieVulkan::Device* device, NugieVulkan::DescriptorPool* descriptorPool,
		std::vector<VkDescriptorBufferInfo> uniformBufferInfo, VkDescriptorBufferInfo modelsInfo[1]) 
	{
		this->createDescriptor(device, descriptorPool, uniformBufferInfo, modelsInfo);
  }

	ShadowDescSet::~ShadowDescSet() {
		if (this->descSetLayout != nullptr) delete this->descSetLayout;
	}

  void ShadowDescSet::createDescriptor(NugieVulkan::Device* device, NugieVulkan::DescriptorPool* descriptorPool,
		std::vector<VkDescriptorBufferInfo> uniformBufferInfo, VkDescriptorBufferInfo modelsInfo[1]) 
	{
    this->descSetLayout = 
			NugieVulkan::DescriptorSetLayout::Builder(device)
				.addBinding(0, VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, VK_SHADER_STAGE_GEOMETRY_BIT)
				.addBinding(1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_VERTEX_BIT)
				.build();
		
	this->descriptorSets.clear();
		for (int i = 0; i < NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT; i++) {
			VkDescriptorSet descSet;

			auto x = NugieVulkan::DescriptorWriter(device, this->descSetLayout, descriptorPool)
				.writeBuffer(0, uniformBufferInfo[i])
				.writeBuffer(1, modelsInfo[0])
				.build(&descSet);
			
			this->descriptorSets.emplace_back(descSet);
		}
  }
}