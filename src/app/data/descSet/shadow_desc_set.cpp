#include "shadow_desc_set.hpp"
#include "../../../vulkan/descriptor/descriptor_writer.hpp"

namespace NugieApp {
  ShadowDescSet::ShadowDescSet(NugieVulkan::Device* device, NugieVulkan::DescriptorPool* descriptorPool, VkDescriptorBufferInfo modelsInfo[2]) 
	{
		this->createDescriptor(device, descriptorPool, modelsInfo);
  }

	ShadowDescSet::~ShadowDescSet() {
		if (this->descSetLayout != nullptr) delete this->descSetLayout;
	}

  void ShadowDescSet::createDescriptor(NugieVulkan::Device* device, NugieVulkan::DescriptorPool* descriptorPool, VkDescriptorBufferInfo modelsInfo[2]) 
	{
    this->descSetLayout = 
			NugieVulkan::DescriptorSetLayout::Builder(device)
				.addBinding(0, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_VERTEX_BIT)
				.addBinding(1, VK_DESCRIPTOR_TYPE_STORAGE_BUFFER, VK_SHADER_STAGE_GEOMETRY_BIT)
				.build();
		
	this->descriptorSets.clear();
		for (int i = 0; i < NugieVulkan::Device::MAX_FRAMES_IN_FLIGHT; i++) {
			VkDescriptorSet descSet;

			auto x = NugieVulkan::DescriptorWriter(device, this->descSetLayout, descriptorPool)
				.writeBuffer(0, modelsInfo[0])
				.writeBuffer(1, modelsInfo[1])
				.build(&descSet);
			
			this->descriptorSets.emplace_back(descSet);
		}
  }
}